// Manual orphan kill with PID-reuse protection (plan step 5).
//
// Before killing, the live process's name is re-checked against the name
// captured when the orphan was recorded — if the OS recycled the pid for an
// unrelated process, we refuse to kill. After the kill we poll the census to
// confirm death, then clear the resolved pid from the spawn ledger.

import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import { findAlive, snapshotProcessTable, type ProcessInfo } from '../processCensus.js';
import { clearOrphans, getOrphanSuspects } from './spawnLedger.js';

export type KillOrphanResult = 'killed' | 'already-gone' | 'name-mismatch' | 'survived'

const CONFIRM_INTERVAL_MS = 400
const CONFIRM_MAX_WAIT_MS = 2000

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\.exe$/, '')
}

export function namesMatch(live: string | undefined, expected: string): boolean {
  if (!live) return false
  const a = normalizeName(live)
  const b = normalizeName(expected)
  return a === b || a.includes(b) || b.includes(a)
}

function hardKillPid(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.unref()
      return
    } catch {
      // Fall through to the POSIX-style kill below.
    }
  }
  // Group kill first: if the orphan is a process-group leader (e.g. it was
  // spawned detached), this reaps its children in one shot. Falls back to a
  // pid-chain tree kill when the group doesn't exist (ESRCH) or is refused.
  try {
    process.kill(-pid, 'SIGKILL')
    return
  } catch {
    // Not a group leader — walk the pid chain instead.
  }
  treeKill(pid, 'SIGKILL')
}

function clearResolvedOrphans(pid: number): void {
  for (const { entry } of getOrphanSuspects()) {
    if (entry.orphans?.some((o) => o.pid === pid)) {
      clearOrphans(entry.taskId, [pid])
    }
  }
}

export async function killOrphanProcess(
  pid: number,
  expectedName: string,
  deps: {
    snapshot?: () => Promise<ProcessInfo[]>
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<KillOrphanResult> {
  const snapshot = deps.snapshot ?? snapshotProcessTable
  const wait = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // Identity re-check against a fresh census before touching the pid.
  const table = await snapshot()
  const live = table.find((p) => p.pid === pid)
  if (!live) {
    // Nothing to kill — treat as resolved so the ledger stays accurate.
    clearResolvedOrphans(pid)
    return 'already-gone'
  }
  if (!namesMatch(live.name, expectedName)) {
    return 'name-mismatch'
  }

  hardKillPid(pid)

  const deadline = Date.now() + CONFIRM_MAX_WAIT_MS
  while (Date.now() < deadline) {
    await wait(CONFIRM_INTERVAL_MS)
    if (findAlive(await snapshot(), [pid]).length === 0) {
      clearResolvedOrphans(pid)
      return 'killed'
    }
  }
  return 'survived'
}
