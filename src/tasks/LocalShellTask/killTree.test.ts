import { describe, expect, it } from 'bun:test'
import { killTaskTree } from './killTree.js'
import {
  getLedgerEntry,
  getOrphanSuspects,
  recordSpawn,
  resetSpawnLedgerForTests,
} from '../../utils/task/spawnLedger.js'
import type { ProcessInfo } from '../../utils/processCensus.js'

const proc = (pid: number, ppid: number, name: string): ProcessInfo => ({
  pid,
  ppid,
  name,
})

const noWait = () => Promise.resolve()

describe('killTaskTree', () => {
  it('captures descendants pre-kill, verifies all died, records nothing', async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't1',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    // Pre-kill: shell 100 with chain 200 -> 300. Post-kill: everything gone
    // (300 re-parented away, which is exactly why the pre-kill capture matters).
    const tables: ProcessInfo[][] = [
      [proc(1, 0, 'init'), proc(100, 1, 'bash'), proc(200, 100, 'tail'), proc(300, 200, 'grep')],
      [],
    ]
    let call = 0
    const snapshot = async () => tables[Math.min(call++, tables.length - 1)] ?? []

    const survivors = await killTaskTree('t1', 100, () => {}, {
      snapshot,
      sleep: noWait,
    })

    expect(survivors).toEqual([])
    expect(getOrphanSuspects()).toEqual([])
    const entry = getLedgerEntry('t1')
    expect(entry?.killedAt).toBeDefined()
    expect(entry?.capturedDescendants?.map((p) => p.pid).sort()).toEqual([200, 300])
  })

  it('records descendants that survive the kill as orphans', async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't2',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    // Pre-kill census finds 200 (tail) and 300 (grep); after the kill the
    // shell and tail are gone but grep survives.
    const tables: ProcessInfo[][] = [
      [proc(100, 1, 'bash'), proc(200, 100, 'tail'), proc(300, 200, 'grep')],
      [proc(300, 1, 'grep')],
    ]
    let call = 0
    const snapshot = async () => tables[Math.min(call++, tables.length - 1)] ?? []

    const survivors = await killTaskTree('t2', 100, () => {}, {
      snapshot,
      sleep: noWait,
    })

    expect(survivors.map((p) => p.pid)).toEqual([300])
    const suspects = getOrphanSuspects()
    expect(suspects).toHaveLength(1)
    expect(suspects[0]?.orphan).toMatchObject({ pid: 300, name: 'grep' })
    expect(suspects[0]?.entry.taskId).toBe('t2')
  })

  it('defers nothing itself but is awaited so evictTaskOutput can be gated', async () => {
    // killTaskTree resolves only after verification completes, so callers can
    // gate output eviction on the survivor result (see killShellTasks.killTask).
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't3',
      shellPid: 100,
      command: 'sleep 60',
      description: 'watch',
      startedAt: 0,
    })
    let killed = false
    const snapshot = async (): Promise<ProcessInfo[]> => (killed ? [] : [proc(100, 1, 'bash')])
    const promise = killTaskTree('t3', 100, () => {
      killed = true
    }, { snapshot, sleep: noWait })
    expect(getLedgerEntry('t3')?.killedAt).toBeUndefined() // census ran, kill not yet
    await promise
    expect(getLedgerEntry('t3')?.killedAt).toBeDefined()
  })

  it('records the surviving shell itself as an orphan', async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't4',
      shellPid: 100,
      command: 'sleep 60',
      description: 'watch',
      startedAt: 0,
    })
    // Pre-kill: shell 100 with child 200. Post-kill: the child died but the
    // hard kill failed to reap the shell — it must be recorded as an orphan.
    const tables: ProcessInfo[][] = [
      [proc(100, 1, 'bash'), proc(200, 100, 'sleep')],
      [proc(100, 1, 'bash')],
    ]
    let call = 0
    const snapshot = async () => tables[Math.min(call++, tables.length - 1)] ?? []

    const survivors = await killTaskTree('t4', 100, () => {}, {
      snapshot,
      sleep: noWait,
    })

    expect(survivors.map((p) => p.pid)).toEqual([100])
    const suspects = getOrphanSuspects()
    expect(suspects).toHaveLength(1)
    expect(suspects[0]?.orphan.pid).toBe(100)
    expect(suspects[0]?.entry.taskId).toBe('t4')
  })
})
