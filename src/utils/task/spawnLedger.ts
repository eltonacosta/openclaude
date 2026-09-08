/**
 * Module-level ledger of spawned background shell tasks.
 *
 * Lives outside AppState and outside the task registry so it survives task
 * output eviction: when a killed task disappears from /tasks, we still know
 * which descendant PIDs were captured around kill time and which of those
 * were later confirmed to survive (orphans).
 */

import type { ProcessInfo } from '../processCensus.js'

export type SpawnLedgerEntry = {
  taskId: string
  shellPid?: number
  command: string
  description: string
  kind?: string
  startedAt: number
  outputPath?: string
  /** Set when a kill of this task begins. */
  killedAt?: number
  /** Descendants captured in the pre-kill census, while ppid links were valid. */
  capturedDescendants?: ProcessInfo[]
  /** Captured processes confirmed alive after the kill completed. */
  orphans?: ProcessInfo[]
}

const ledger = new Map<string, SpawnLedgerEntry>()

export function recordSpawn(entry: Omit<SpawnLedgerEntry, 'killedAt' | 'capturedDescendants' | 'orphans'>): void {
  ledger.set(entry.taskId, {
    ...entry,
    startedAt: entry.startedAt ?? Date.now(),
  })
}

export function getLedgerEntry(taskId: string): SpawnLedgerEntry | undefined {
  return ledger.get(taskId)
}

export function getAllLedgerEntries(): SpawnLedgerEntry[] {
  return Array.from(ledger.values())
}

/** Records the start of a kill along with the pre-kill descendant census. */
export function markKillStart(taskId: string, capturedDescendants: ProcessInfo[]): void {
  const entry = ledger.get(taskId)
  if (!entry) return
  entry.killedAt = Date.now()
  entry.capturedDescendants = capturedDescendants
}

/** Records descendants confirmed to have survived a kill. */
export function recordOrphans(taskId: string, orphans: ProcessInfo[]): void {
  const entry = ledger.get(taskId)
  if (!entry || orphans.length === 0) return
  const known = new Set((entry.orphans ?? []).map((o) => o.pid))
  const fresh = orphans.filter((o) => !known.has(o.pid))
  entry.orphans = [...(entry.orphans ?? []), ...fresh]
}

/** Removes a ledger entry once all of its orphans have been resolved. */
export function removeLedgerEntry(taskId: string): void {
  ledger.delete(taskId)
}

export type OrphanSuspect = {
  entry: SpawnLedgerEntry
  orphan: ProcessInfo
}

/** Flattened list of all known surviving processes across ledger entries. */
export function getOrphanSuspects(): OrphanSuspect[] {
  const suspects: OrphanSuspect[] = []
  for (const entry of ledger.values()) {
    for (const orphan of entry.orphans ?? []) {
      suspects.push({ entry, orphan })
    }
  }
  return suspects
}

/** Drops orphan records for pids no longer alive (e.g. killed via /tasks). */
export function clearOrphans(taskId: string, resolvedPids: number[]): void {
  const entry = ledger.get(taskId)
  if (!entry) return
  const resolved = new Set(resolvedPids)
  entry.orphans = (entry.orphans ?? []).filter((o) => !resolved.has(o.pid))
  if ((entry.orphans ?? []).length === 0) {
    // Entry fully resolved — drop it so the ledger does not grow unbounded.
    removeLedgerEntry(taskId)
  }
}

export function resetSpawnLedgerForTests(): void {
  ledger.clear()
}
