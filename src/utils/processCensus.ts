/**
 * Process census utilities for background-process monitoring.
 *
 * Provides a platform-appropriate snapshot of the running process table
 * (win32 via a one-shot PowerShell CIM query, linux via /proc, darwin via ps)
 * plus pure helpers to resolve descendant processes and confirm liveness.
 * Used by the spawn ledger / orphan watchdog to detect processes that
 * survive a TaskStop.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'

export type ProcessInfo = {
  pid: number
  ppid: number
  name: string
  commandLine?: string
  memoryBytes?: number
  startedAtMs?: number
}

const CENSUS_TIMEOUT_MS = 8000

const WIN32_CENSUS_SCRIPT =
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,CreationDate | ' +
  'ConvertTo-Json -Compress'

const DARWIN_PS_ARGS = ['-axo', 'pid=,ppid=,rss=,etime=,command=']

// Standard Linux jiffies-per-second for /proc stat fields (userland ABI).
const CLK_TCK = 100

const PAGE_SIZE = (() => {
  try {
    return (os as { pagesize?: () => number }).pagesize?.() ?? 4096
  } catch {
    return 4096
  }
})()

function toInt(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

function basename(pathLike: string): string {
  const idx = Math.max(pathLike.lastIndexOf('/'), pathLike.lastIndexOf('\\'))
  return idx === -1 ? pathLike : pathLike.slice(idx + 1)
}

/** Parses PowerShell CIM CreationDate values ("/Date(ms)/" or ISO strings). */
export function parseCimDate(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const msMatch = /\/Date\((-?\d+)/.exec(value)
  if (msMatch) return Number(msMatch[1])
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Parses compressed ConvertTo-Json output of the Win32_Process census query. */
export function parseWin32CensusJson(stdout: string): ProcessInfo[] {
  if (!stdout || !stdout.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const table: ProcessInfo[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const pid = toInt(r.ProcessId)
    const ppid = toInt(r.ParentProcessId)
    if (pid === undefined || ppid === undefined) continue
    table.push({
      pid,
      ppid,
      name: typeof r.Name === 'string' ? r.Name : '',
      commandLine: typeof r.CommandLine === 'string' ? r.CommandLine : undefined,
      memoryBytes: toInt(r.WorkingSetSize),
      startedAtMs: parseCimDate(r.CreationDate),
    })
  }
  return table
}

/** Parses a Linux /proc/<pid>/stat line (comm-safe, paren-aware). */
export function parseProcStat(
  statContent: string,
): { ppid: number; starttime: number; rssPages: number; comm: string } | undefined {
  const openParen = statContent.indexOf('(')
  const closeParen = statContent.lastIndexOf(')')
  if (openParen === -1 || closeParen === -1 || closeParen < openParen) return undefined
  const comm = statContent.slice(openParen + 1, closeParen)
  // after[0] is field 3 (state); ppid is field 4, starttime field 22, rss field 24.
  const after = statContent
    .slice(closeParen + 1)
    .split(/\s+/)
    .filter((t) => t !== '')
  const ppid = toInt(after[1])
  const starttime = toInt(after[19])
  const rssPages = toInt(after[21])
  if (ppid === undefined || starttime === undefined) return undefined
  return { ppid, starttime, rssPages: rssPages ?? 0, comm }
}

/** Parses ps etime values of the form [[dd-]hh:]mm:ss into seconds. */
export function parsePsEtime(etime: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim())
  if (!m) return undefined
  const days = m[1] ? Number(m[1]) : 0
  const hours = m[2] ? Number(m[2]) : 0
  const minutes = Number(m[3])
  const seconds = Number(m[4])
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

/** Parses `ps -axo pid=,ppid=,rss=,etime=,command=` output. */
export function parseDarwinPsOutput(stdout: string, nowMs: number = Date.now()): ProcessInfo[] {
  const table: ProcessInfo[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(trimmed)
    if (!match) continue
    const pid = toInt(match[1])
    const ppid = toInt(match[2])
    if (pid === undefined || ppid === undefined) continue
    const rssKb = toInt(match[3])
    const elapsedSec = parsePsEtime(match[4] ?? '')
    const command = (match[5] ?? '').trim()
    table.push({
      pid,
      ppid,
      name: command ? basename(command.split(/\s+/)[0] ?? '') : '',
      commandLine: command || undefined,
      memoryBytes: rssKb !== undefined ? rssKb * 1024 : undefined,
      startedAtMs: elapsedSec !== undefined ? nowMs - elapsedSec * 1000 : undefined,
    })
  }
  return table
}

async function snapshotWin32(): Promise<ProcessInfo[]> {
  const result = await execFileNoThrowWithCwd(
    'powershell.exe',
    ['-NoProfile', '-Command', WIN32_CENSUS_SCRIPT],
    { timeout: CENSUS_TIMEOUT_MS, maxBuffer: 4_000_000 },
  )
  if (result.code !== 0 || !result.stdout?.trim()) return []
  return parseWin32CensusJson(result.stdout)
}

function snapshotLinux(): ProcessInfo[] {
  let bootTimeMs: number | undefined
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8')
    const m = /^btime\s+(\d+)/m.exec(stat)
    if (m) bootTimeMs = Number(m[1]) * 1000
  } catch {
    // btime is optional for our purposes
  }
  const entries = fs.readdirSync('/proc')
  const table: ProcessInfo[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    let statContent: string
    let cmdline = ''
    try {
      statContent = fs.readFileSync(`/proc/${entry}/stat`, 'utf8')
      try {
        cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      } catch {
        cmdline = ''
      }
    } catch {
      continue // process vanished between readdir and read
    }
    const parsed = parseProcStat(statContent)
    if (!parsed) continue
    table.push({
      pid,
      ppid: parsed.ppid,
      name: parsed.comm,
      commandLine: cmdline ? cmdline.split('\0').filter(Boolean).join(' ') : undefined,
      memoryBytes: parsed.rssPages * PAGE_SIZE,
      startedAtMs:
        bootTimeMs !== undefined
          ? bootTimeMs + (parsed.starttime * 1000) / CLK_TCK
          : undefined,
    })
  }
  return table
}

async function snapshotDarwin(): Promise<ProcessInfo[]> {
  const result = await execFileNoThrowWithCwd('ps', DARWIN_PS_ARGS, {
    timeout: CENSUS_TIMEOUT_MS,
    maxBuffer: 4_000_000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) return []
  return parseDarwinPsOutput(result.stdout)
}

/**
 * One-shot process table snapshot for the current platform.
 * Returns an empty array on any error or unsupported platform.
 */
export async function snapshotProcessTable(): Promise<ProcessInfo[]> {
  try {
    switch (process.platform) {
      case 'win32':
        return await snapshotWin32()
      case 'darwin':
        return await snapshotDarwin()
      case 'linux':
        return snapshotLinux()
      default:
        return []
    }
  } catch {
    return []
  }
}

const CENSUS_DEFAULT_MAX_AGE_MS = 2000

let cachedTable: ProcessInfo[] = []
let cachedAtMs = 0
let inFlight: Promise<ProcessInfo[]> | null = null

/**
 * Memoized census: reuses a snapshot younger than maxAgeMs and coalesces
 * concurrent callers onto one in-flight snapshot. Only non-empty results are
 * cached so a transient enumeration failure does not wipe a good snapshot.
 */
export function getCensus(maxAgeMs = CENSUS_DEFAULT_MAX_AGE_MS): Promise<ProcessInfo[]> {
  const now = Date.now()
  if (cachedTable.length > 0 && now - cachedAtMs < maxAgeMs) {
    return Promise.resolve(cachedTable)
  }
  if (inFlight) return inFlight
  inFlight = snapshotProcessTable()
    .then((table) => {
      if (table.length > 0) {
        cachedTable = table
        cachedAtMs = Date.now()
      }
      return table
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * Returns the transitive set of descendant processes of rootPid present in the
 * table. Cycle-safe; excludes the root itself. Note: descendants of an already
 * dead intermediate shell may have been re-parented and are undiscoverable.
 */
export function getDescendants(table: ProcessInfo[], rootPid: number): ProcessInfo[] {
  const childrenOf = new Map<number, ProcessInfo[]>()
  for (const proc of table) {
    const siblings = childrenOf.get(proc.ppid)
    if (siblings) siblings.push(proc)
    else childrenOf.set(proc.ppid, [proc])
  }
  const result: ProcessInfo[] = []
  const visited = new Set<number>([rootPid])
  const queue: number[] = [rootPid]
  while (queue.length > 0) {
    const pid = queue.pop() as number
    for (const child of childrenOf.get(pid) ?? []) {
      if (visited.has(child.pid)) continue
      visited.add(child.pid)
      result.push(child)
      queue.push(child.pid)
    }
  }
  return result
}

/** Returns table rows whose pid appears in pids, in table order, deduplicated. */
export function findAlive(table: ProcessInfo[], pids: number[]): ProcessInfo[] {
  const wanted = new Set(pids)
  const seen = new Set<number>()
  const result: ProcessInfo[] = []
  for (const proc of table) {
    if (!wanted.has(proc.pid) || seen.has(proc.pid)) continue
    seen.add(proc.pid)
    result.push(proc)
  }
  return result
}

export function resetProcessCensusForTests(): void {
  cachedTable = []
  cachedAtMs = 0
  inFlight = null
}
