// Session orphan watchdog (plan step 4).
//
// Armed once on the first shell spawn. Every 30s it reconciles the spawn
// ledger's captured descendants (from killed shells) against a fresh process
// census; anything still alive is recorded as an orphan and the total orphan
// count is mirrored into AppState.orphanAlertCount so the footer indicator is
// reactive. The watchdog only reports — it never kills anything.

import type { AppState } from '../state/AppState.js'
import type { ProcessInfo } from '../utils/processCensus.js'
import { findAlive, snapshotProcessTable } from '../utils/processCensus.js'
import { logForDebugging } from '../utils/debug.js'
import {
  clearOrphans,
  getAllLedgerEntries,
  getOrphanSuspects,
  recordOrphans,
} from '../utils/task/spawnLedger.js'

const WATCHDOG_INTERVAL_MS = 30_000

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

let timer: ReturnType<typeof setInterval> | null = null
let setAppStateRef: SetAppStateFn | null = null
let lastAlertCount = -1

/**
 * Arm the 30s watchdog. Idempotent — the first call wins; later spawns are
 * no-ops. The ledger's orphan suspects list is the source of truth; AppState
 * only mirrors the count for UI reactivity.
 */
export function armOrphanWatchdog(setAppState: SetAppStateFn): void {
  if (setAppStateRef || timer) {
    return
  }
  setAppStateRef = setAppState
  timer = setInterval(() => {
    void runOrphanWatchdogTick()
  }, WATCHDOG_INTERVAL_MS)
  timer.unref?.()
  logForDebugging(
    `orphanWatchdog: armed (interval ${WATCHDOG_INTERVAL_MS}ms)`,
  )
}

/**
 * One watchdog pass: verify captured descendants of killed shells against a
 * fresh census, record new orphans, and sync orphanAlertCount into AppState.
 * Returns the current unique orphan count.
 */
export async function runOrphanWatchdogTick(
  deps: { snapshot?: () => Promise<ProcessInfo[]> } = {},
): Promise<number> {
  const snapshot = deps.snapshot ?? snapshotProcessTable

  // Only entries that had a kill with pre-kill captured descendants can have
  // orphans to rediscover.
  const killed = getAllLedgerEntries().filter(
    (e) => e.killedAt !== undefined && (e.capturedDescendants?.length ?? 0) > 0,
  )
  const suspects = getOrphanSuspects()
  if (killed.length > 0 || suspects.length > 0) {
    const table = await snapshot()
    // A transient empty census (enumeration failure) must not wipe recorded
    // orphans — only trust a non-empty table for liveness decisions.
    if (table.length > 0) {
      for (const entry of killed) {
        const watchedPids = entry.capturedDescendants!.map((d) => d.pid)
        const alive = findAlive(table, watchedPids)
        if (alive.length > 0) {
          recordOrphans(entry.taskId, alive)
        }
      }
      // Re-verify already-recorded orphans: drop pids that have since died on
      // their own so the ledger and footer indicator don't show stale orphans.
      for (const suspect of suspects) {
        if (findAlive(table, [suspect.orphan.pid]).length === 0) {
          clearOrphans(suspect.entry.taskId, [suspect.orphan.pid])
        }
      }
    }
  }

  // Unique orphan pids across the ledger (entries can share a process).
  const orphans = getOrphanSuspects()
  const count = new Set(orphans.map((s) => s.orphan.pid)).size
  if (count !== lastAlertCount && setAppStateRef) {
    lastAlertCount = count
    setAppStateRef((prev) => ({ ...prev, orphanAlertCount: count }))
  }
  return count
}

export function resetOrphanWatchdogForTests(): void {
  if (timer) {
    clearInterval(timer)
  }
  timer = null
  setAppStateRef = null
  lastAlertCount = -1
}
