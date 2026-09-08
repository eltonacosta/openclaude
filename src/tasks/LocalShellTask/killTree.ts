// Tree kill with verification for LocalShellTask.
//
// A pre-kill census captures the shell's descendants while ppid links are
// still valid (once the shell dies, children are re-parented and post-hoc
// discovery is unreliable). After the hard kill, we poll the census to
// confirm everything died; anything that survives is recorded in the spawn
// ledger as an orphan for the watchdog and the /tasks dialog. We never
// auto-kill orphans — they are surfaced for manual kill.

import {
  findAlive,
  getCensus,
  getDescendants,
  snapshotProcessTable,
  type ProcessInfo,
} from '../../utils/processCensus.js'
import { markKillStart, recordOrphans } from '../../utils/task/spawnLedger.js'
import { logForDebugging } from '../../utils/debug.js'

const VERIFY_INTERVAL_MS = 400
const VERIFY_MAX_WAIT_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type HardKillFn = () => void

/**
 * Captures descendants of shellPid from the process table (pre-kill), runs
 * hardKill, then polls the census until all captured pids are gone or the
 * verify window elapses. Returns the surviving processes (orphans), which
 * are also recorded in the spawn ledger.
 */
export async function killTaskTree(
  taskId: string,
  shellPid: number | undefined,
  hardKill: HardKillFn,
  deps: {
    snapshot?: () => Promise<ProcessInfo[]>
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<ProcessInfo[]> {
  const snapshot = deps.snapshot ?? snapshotProcessTable
  const preKillSnapshot = deps.snapshot ?? (() => getCensus())
  const wait = deps.sleep ?? sleep
  // Pre-kill census: capture descendants while ppid links are still valid.
  let descendants: ProcessInfo[] = []
  if (shellPid !== undefined) {
    let table = await preKillSnapshot()
    if (table.length === 0) {
      // Cached census empty (cold cache or transient failure) — try once more.
      table = await snapshot()
    }
    descendants = getDescendants(table, shellPid)
  }
  markKillStart(taskId, descendants)

  await hardKill()

  // Verify by polling the census. Each check is a fresh snapshot — memoized
  // census could return a pre-kill table, so use snapshotProcessTable directly.
  const watchedPids = [shellPid, ...descendants.map((d) => d.pid)].filter(
    (pid): pid is number => typeof pid === 'number',
  )
  const deadline = Date.now() + VERIFY_MAX_WAIT_MS
  let survivors: ProcessInfo[] = []
  while (Date.now() < deadline) {
    await wait(VERIFY_INTERVAL_MS)
    survivors = findAlive(await snapshot(), watchedPids)
    if (survivors.length === 0) {
      return []
    }
  }

  // Every survivor is an orphan — including the shell itself when the hard
  // kill failed to reap it. The task row is already marked killed and its
  // shellCommand nulled by the caller, so without this entry the surviving
  // shell would be invisible to the watchdog and the /tasks dialog.
  const orphans = survivors
  if (orphans.length > 0) {
    recordOrphans(taskId, orphans)
    logForDebugging(
      `killTaskTree: ${orphans.length} orphaned process(es) survived kill of task ${taskId}: ${orphans
        .map((o) => `${o.name}(${o.pid})`)
        .join(', ')}`,
      { level: 'warn' },
    )
  }
  return survivors
}
