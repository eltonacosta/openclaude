import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { toString as qrToString } from 'qrcode'
import { generatePassword, loadPanelConfig } from './panelAuth.js'
import { getLanAddresses } from './panelNet.js'
import { startPanelServer } from './panelServer.js'

export type ServeOptions = {
  port?: string
  host?: string
  password?: string
}

async function promptPassword(question: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function resolvePassword(explicit?: string): Promise<{ password: string | null; isNew: boolean }> {
  const config = await loadPanelConfig()
  if (explicit) return { password: explicit, isNew: !config.passwordHash }
  if (config.passwordHash) return { password: null, isNew: false }
  // First run: create a password interactively (or generate one when headless).
  if (!process.stdin.isTTY) {
    return { password: generatePassword(), isNew: true }
  }
  for (;;) {
    const first = await promptPassword('Create a panel password (min 8 chars): ')
    if (first.length < 8) {
      process.stderr.write('Password must be at least 8 characters.\n')
      continue
    }
    const second = await promptPassword('Repeat the panel password: ')
    if (first !== second) {
      process.stderr.write('Passwords do not match. Try again.\n')
      continue
    }
    return { password: first, isNew: true }
  }
}

function printQr(url: string): Promise<void> {
  return qrToString(url, { type: 'utf8', errorCorrectionLevel: 'L' })
    .then(text => {
      process.stdout.write(`\nScan from your phone:\n${text}\n`)
    })
    .catch(() => {})
}

export async function serveHandler(options: ServeOptions): Promise<void> {
  const port = Number.parseInt(options.port ?? '3100', 10)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('Invalid --port (1-65535).\n')
    process.exit(1)
  }
  const host = options.host ?? '0.0.0.0'

  const { password, isNew } = await resolvePassword(options.password)
  // startPanelServer persists --password / first-setup passwords to panel.json.
  const server = await startPanelServer({
    port,
    host,
    password: password ?? undefined,
    projectDir: process.cwd(),
  })

  if (isNew && password) {
    process.stdout.write(`\nPanel password: ${password}\nSave it — it is stored hashed in ~/.openclaude/panel.json.\n`)
  }

  const lanUrls = getLanAddresses().map(address => `http://${address}:${server.port}`)
  process.stdout.write(`\nOrbit Code panel running (local network only):\n`)
  process.stdout.write(`  Local:  ${server.localUrl}\n`)
  for (const url of lanUrls) process.stdout.write(`  LAN:    ${url}\n`)
  if (lanUrls[0]) await printQr(lanUrls[0])

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await server.stop().catch(() => {})
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  // Park the process: the HTTP server keeps the event loop alive.
  await new Promise(() => {})
}
