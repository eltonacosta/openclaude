// Pure (non-React) kill helpers for LocalShellTask.
// Extracted so runAgent.ts can kill agent-scoped bash tasks without pulling
// React/Ink into its module graph (same rationale as guards.ts).

import type { AppState } from '../../state/AppState.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { dequeueAllMatching } from '../../utils/messageQueueManager.js'
import { evictTaskOutput, getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'
import { recordSpawn, removeLedgerEntry } from '../../utils/task/spawnLedger.js'
import { armOrphanWatchdog } from '../orphanWatchdog.js'
import { isLocalShellTask } from './guards.js'
import { killTaskTree } from './killTree.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

/**
 * Records a shell spawn in the orphan ledger and arms the orphan watchdog.
 * The ledger entry survives task eviction so orphaned descendants of a killed
 * shell stay traceable after the task leaves the registry. Called from both
 * spawn paths (backgrounded spawnShellTask and foreground->background) so the
 * kill-verification path always has an entry to write captured descendants into.
 */
export function recordShellSpawn(input: {
  taskId: string
  shellPid: number | undefined
  command: string
  description: string
  kind?: string
  agentId?: AgentId
}, setAppState: SetAppStateFn): void {
  recordSpawn({
    taskId: input.taskId,
    shellPid: input.shellPid,
    command: input.command,
    description: input.description,
    kind: input.kind,
    startedAt: Date.now(),
    outputPath: getTaskOutputPath(input.taskId),
  })
  armOrphanWatchdog(setAppState)
}

export async function killTask(taskId: string, setAppState: SetAppStateFn): Promise<void> {
  // Capture the shell pid before any state mutation so the pre-kill census
  // can enumerate its descendants while the ppid links are still valid.
  let shellPid: number | undefined

  updateTaskState(taskId, setAppState, task => {
    if (task.status !== 'running' || !isLocalShellTask(task)) {
      return task
    }

    shellPid = task.shellCommand?.pid

    try {
      logForDebugging(`LocalShellTask ${taskId} kill requested`)
      // The actual tree kill runs below via killTaskTree so the census lands
      // before the shell dies; shellCommand.kill() is invoked as the hard kill.
      task.unregisterCleanup?.()
      if (task.cleanupTimeoutId) {
        clearTimeout(task.cleanupTimeoutId)
      }
    } catch (error) {
      logError(error)
    }

    return {
      ...task,
      status: 'killed',
      notified: true,
      unregisterCleanup: undefined,
      cleanupTimeoutId: undefined,
      endTime: Date.now(),
    }
  })

  if (shellPid === undefined) {
    // Nothing running was updated (already finished, or not a shell task) —
    // keep legacy eviction behavior and drop any stale ledger entry.
    void evictTaskOutput(taskId)
    removeLedgerEntry(taskId)
    return
  }

  const survivors = await killTaskTree(taskId, shellPid, () => {
    updateTaskState(taskId, setAppState, task => {
      if (!isLocalShellTask(task)) return task
      try {
        task.shellCommand?.kill()
        task.shellCommand?.cleanup()
      } catch (error) {
        logError(error)
      }
      return { ...task, shellCommand: null }
    })
  })

  // Only evict the on-disk output when nothing survived — the output file is
  // the evidence trail for orphan investigation.
  if (survivors.length === 0) {
    void evictTaskOutput(taskId)
    // Nothing survived the kill: the ledger entry served its purpose, drop it
    // so the ledger doesn't grow unbounded across many kills.
    removeLedgerEntry(taskId)
  } else {
    logForDebugging(
      `LocalShellTask ${taskId}: deferring output eviction — ${survivors.length} process(es) still alive`,
      { level: 'warn' },
    )
  }
}

/**
 * Kill all running bash tasks spawned by a given agent.
 * Called from runAgent.ts finally block so background processes don't outlive
 * the agent that started them (prevents 10-day fake-logs.sh zombies).
 */
export function killShellTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppStateFn,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isLocalShellTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killShellTasksForAgent: killing orphaned shell task ${taskId} (agent ${agentId} exiting)`,
      )
      void killTask(taskId, setAppState)
    }
  }
  // Purge any queued notifications addressed to this agent — its query loop
  // has exited and won't drain them. killTask fires 'killed' notifications
  // asynchronously; drop the ones already queued and any that land later sit
  // harmlessly (no consumer matches a dead agentId).
  dequeueAllMatching(cmd => cmd.agentId === agentId)
}
