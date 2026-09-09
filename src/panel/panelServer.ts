import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  assertBackgroundSessionNameAvailable,
  backgroundSessionLogExists,
  createBackgroundSession,
  ensureBackgroundSessionDirs,
  getBackgroundSessionLogPaths,
  isTerminalBackgroundSession,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
  type BackgroundSession,
} from '../cli/bgRegistry.js'
import { generateBackgroundProcessMarker } from '../cli/bgRouting.js'
import { PANEL_HTML } from './panelHtml.js'
import { createSessionToken, hashPassword, loadPanelConfig, savePanelPasswordHash, verifyPassword } from './panelAuth.js'
import { formatLocalUrl, getLanAddresses } from './panelNet.js'

export type PanelServerOptions = {
  port: number
  host: string
  password?: string
  setupPassword?: string
  projectDir?: string
}

export type PanelServerHandle = {
  port: number
  localUrl: string
  stop: () => Promise<void>
}

export type PanelInfo = {
  version: string
  cwd: string
  localUrl: string
  lanUrls: string[]
}

type RouteDeps = {
  version: () => string
  cwd: () => string
  localUrl: () => string
  lanUrls: () => string[]
  sessions: {
    list: () => Promise<BackgroundSession[]>
    readLog: (path: string, maxBytes: number) => Promise<string>
  }
  spawnTask: (input: { name?: string; prompt: string }) => Promise<BackgroundSession>
  killTask: (target: string) => Promise<BackgroundSession>
}

const SESSION_COOKIE = 'oc_panel'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_LOG_BYTES = 64 * 1024
const MAX_BODY_BYTES = 64 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  const header = req.headers.cookie
  if (!header) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

export function parseSessionCookie(req: IncomingMessage): string | null {
  const value = parseCookies(req)[SESSION_COOKIE]
  return value && value.length > 0 ? value : null
}

async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new Error('Request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req)
  if (!text) return {}
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON body')
  }
  return parsed as Record<string, unknown>
}

function publicTask(session: BackgroundSession): Record<string, unknown> {
  return {
    id: session.id,
    name: session.name ?? null,
    status: session.status,
    pid: session.pid,
    cwd: session.cwd,
    provider: session.provider ?? null,
    model: session.model ?? null,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    finishedAt: session.finishedAt ?? null,
    exitCode: session.exitCode ?? null,
  }
}

async function readLogTail(path: string, maxBytes: number): Promise<string> {
  if (!(await backgroundSessionLogExists(path))) return ''
  const info = await stat(path)
  const start = Math.max(0, info.size - maxBytes)
  const handle = await open(path, 'r')
  try {
    const length = Math.min(info.size - start, maxBytes)
    if (length <= 0) return ''
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    return buffer.toString('utf8')
  } finally {
    await handle.close().catch(() => {})
  }
}

function resolveEntrypoint(): string {
  const entrypoint = process.argv[1]
  if (!entrypoint) throw new Error('Cannot determine OpenClaude entrypoint')
  return entrypoint
}

type SpawnInput = { name?: string; prompt: string }

async function spawnPanelTask(input: SpawnInput): Promise<BackgroundSession> {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Prompt is required')
  if (prompt.length > 8_000) throw new Error('Prompt is too long (max 8000 chars)')
  const name = input.name?.trim() || undefined
  if (name && name.length > 80) throw new Error('Name is too long (max 80 chars)')
  await assertBackgroundSessionNameAvailable(name)

  // Reuse the official --bg launch path (buildBackgroundChildProcessConfig):
  // it wires the finalizer registration env, the process marker, and the
  // heap-relaunch guard. Hand-rolling the spawn skips that contract and the
  // child dies with "Background session registration was not established".
  const { buildBackgroundChildProcessConfig, confirmBackgroundSessionLaunch } =
    await import('../cli/bg.js')
  const id = `bg-${randomUUID().slice(0, 8)}`
  const processMarker = generateBackgroundProcessMarker()
  const logPaths = getBackgroundSessionLogPaths(id)
  await ensureBackgroundSessionDirs()

  const entrypoint = resolveEntrypoint()
  const sessionId = randomUUID()
  const childConfig = buildBackgroundChildProcessConfig({
    execPath: process.execPath,
    execArgv: process.execArgv,
    entrypoint,
    childArgs: ['--print', prompt],
    processEnv: process.env,
    sessionName: name,
    stdoutLogPath: logPaths.stdoutLogPath,
    backgroundSessionId: id,
    processMarker,
    launcherPid: process.pid,
  })
  const command = [childConfig.command, ...childConfig.args]

  let stdoutFd: number | undefined
  let stderrFd: number | undefined
  let child: ReturnType<typeof spawn> | undefined
  try {
    stdoutFd = openSync(logPaths.stdoutLogPath, 'wx')
    stderrFd = openSync(logPaths.stderrLogPath, 'wx')
    child = spawn(childConfig.command, childConfig.args, {
      cwd: process.cwd(),
      detached: true,
      env: childConfig.env,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    child.unref()
  } finally {
    if (stdoutFd !== undefined) closeSync(stdoutFd)
    if (stderrFd !== undefined) closeSync(stderrFd)
  }
  if (!child?.pid) {
    await unlink(logPaths.stdoutLogPath).catch(() => {})
    await unlink(logPaths.stderrLogPath).catch(() => {})
    throw new Error('Failed to start background session')
  }

  let session: BackgroundSession
  try {
    session = await createBackgroundSession({
      id,
      name,
      pid: child.pid,
      cwd: process.cwd(),
      command,
      sessionId,
      processMarker,
      stdoutLogPath: logPaths.stdoutLogPath,
      stderrLogPath: logPaths.stderrLogPath,
      logFilesPrecreated: true,
    })
  } catch (error) {
    try {
      process.kill(child.pid, 'SIGKILL')
    } catch {
      // Child already exited — registry write is still rolled back below.
    }
    await unlink(logPaths.stdoutLogPath).catch(() => {})
    await unlink(logPaths.stderrLogPath).catch(() => {})
    throw error
  }
  // Confirm the child registered its finalizer before reporting success, so
  // the panel never shows a phantom running task (mirrors handleBgFlag).
  return confirmBackgroundSessionLaunch(session)
}

export function createPanelRequestHandler(deps: RouteDeps): {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  sessions: Map<string, number>
} {
  const sessions = new Map<string, number>()

  function isAuthed(req: IncomingMessage): boolean {
    const token = parseSessionCookie(req)
    if (!token) return false
    const expires = sessions.get(token)
    if (!expires) return false
    if (expires < Date.now()) {
      sessions.delete(token)
      return false
    }
    return true
  }

  function setSession(res: ServerResponse): void {
    const token = createSessionToken()
    sessions.set(token, Date.now() + SESSION_TTL_MS)
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
    )
  }

  function clearSession(req: IncomingMessage, res: ServerResponse): void {
    const token = parseSessionCookie(req)
    if (token) sessions.delete(token)
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'GET' && pathname === '/') {
      const html = PANEL_HTML
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
      })
      res.end(html)
      return
    }

    if (method === 'GET' && pathname === '/api/info') {
      sendJson(res, 200, {
        version: deps.version(),
        cwd: deps.cwd(),
        localUrl: deps.localUrl(),
        lanUrls: deps.lanUrls(),
      })
      return
    }

    if (method === 'POST' && pathname === '/api/login') {
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' })
        return
      }
      const password = typeof body.password === 'string' ? body.password : ''
      const config = await loadPanelConfig()
      if (!config.passwordHash) {
        if (!password) {
          sendJson(res, 400, { error: 'Choose a password to protect the panel' })
          return
        }
        if (password.length < 8) {
          sendJson(res, 400, { error: 'Password must be at least 8 characters' })
          return
        }
        await savePanelPasswordHash(await hashPassword(password))
        setSession(res)
        sendJson(res, 200, { ok: true, firstSetup: true })
        return
      }
      if (!password || !(await verifyPassword(password, config.passwordHash))) {
        // Same latency shape either way: scrypt already ran for format-valid hashes.
        sendJson(res, 401, { error: 'Senha incorreta' })
        return
      }
      setSession(res)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && pathname === '/api/logout') {
      clearSession(req, res)
      sendJson(res, 200, { ok: true })
      return
    }

    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Not authenticated' })
      return
    }

    if (method === 'GET' && pathname === '/api/tasks') {
      const tasks = await deps.sessions.list()
      sendJson(res, 200, { tasks: tasks.map(publicTask) })
      return
    }

    if (method === 'POST' && pathname === '/api/tasks') {
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' })
        return
      }
      const prompt = typeof body.prompt === 'string' ? body.prompt : ''
      const name = typeof body.name === 'string' ? body.name : undefined
      try {
        const task = await deps.spawnTask({ name, prompt })
        sendJson(res, 201, { task: publicTask(task) })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to start task' })
      }
      return
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(logs|kill)$/)
    if (taskMatch) {
      const [, encodedId, action] = taskMatch as [string, string, string]
      const target = decodeURIComponent(encodedId ?? '')
      let session: BackgroundSession
      try {
        session = await resolveBackgroundSession(target)
      } catch {
        sendJson(res, 404, { error: `No background session found for "${target}"` })
        return
      }
      if (action === 'logs' && method === 'GET') {
        const stream = url.searchParams.get('stream') === 'stderr' ? 'stderr' : 'stdout'
        const logPath = stream === 'stderr' ? session.stderrLogPath : session.stdoutLogPath
        const logs = await deps.sessions.readLog(logPath, MAX_LOG_BYTES)
        sendJson(res, 200, { id: session.id, stream, logs })
        return
      }
      if (action === 'kill' && method === 'POST') {
        try {
          const killed = await deps.killTask(session.id)
          sendJson(res, 200, { task: publicTask(killed) })
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to kill task' })
        }
        return
      }
    }

    sendJson(res, 404, { error: 'Not found' })
  }

  return { handle, sessions }
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelServerHandle> {
  const { killBackgroundSession } = await import('../cli/bg.js')
  const deps: RouteDeps = {
    version: () => MACRO.DISPLAY_VERSION ?? MACRO.VERSION,
    cwd: () => options.projectDir ?? process.cwd(),
    localUrl: () => formatLocalUrl(boundPort, options.host),
    lanUrls: () =>
      getLanAddresses().map(address => `http://${address}:${boundPort}`),
    sessions: {
      list: () => refreshBackgroundSessionStatuses(),
      readLog: (path, maxBytes) => readLogTail(path, maxBytes),
    },
    spawnTask: input => spawnPanelTask(input),
    killTask: async target => {
      await refreshBackgroundSessionStatuses()
      const session = await resolveBackgroundSession(target)
      if (isTerminalBackgroundSession(session)) return session
      return killBackgroundSession(session)
    },
  }
  const { handle } = createPanelRequestHandler(deps)

  let boundPort = options.port
  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal server error' })
      } else {
        res.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      const address = server.address() as AddressInfo | null
      if (address && typeof address.port === 'number') boundPort = address.port
      resolve()
    })
  })

  if (options.password) {
    await savePanelPasswordHash(await hashPassword(options.password))
  } else if (options.setupPassword) {
    await savePanelPasswordHash(await hashPassword(options.setupPassword))
  }

  return {
    port: boundPort,
    localUrl: formatLocalUrl(boundPort, options.host),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
