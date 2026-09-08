import { describe, expect, it } from 'bun:test'
import {
  armOrphanWatchdog,
  resetOrphanWatchdogForTests,
  runOrphanWatchdogTick,
} from './orphanWatchdog.js'
import {
  clearOrphans,
  getOrphanSuspects,
  markKillStart,
  recordOrphans,
  recordSpawn,
  resetSpawnLedgerForTests,
} from '../utils/task/spawnLedger.js'
import type { ProcessInfo } from '../utils/processCensus.js'

const proc = (pid: number, ppid: number, name: string): ProcessInfo => ({
  pid,
  ppid,
  name,
})

describe('orphanWatchdog', () => {
  it('records survivors of killed shells as orphans and mirrors count to AppState', async () => {
    resetSpawnLedgerForTests()
    resetOrphanWatchdogForTests()
    recordSpawn({
      taskId: 't1',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t1', [proc(200, 100, 'tail'), proc(300, 200, 'grep')])

    // Post-kill census: shell and tail gone, grep (300) survived.
    const snapshot = async (): Promise<ProcessInfo[]> => [proc(300, 1, 'grep')]
    const states: unknown[] = []
    armOrphanWatchdog(((updater: (s: { orphanAlertCount: number }) => { orphanAlertCount: number }) => {
      states.push(updater({ orphanAlertCount: 0 }))
    }) as never)

    const count = await runOrphanWatchdogTick({ snapshot })

    expect(count).toBe(1)
    const suspects = getOrphanSuspects()
    expect(suspects).toHaveLength(1)
    expect(suspects[0]?.orphan.pid).toBe(300)
    expect(suspects[0]?.entry.taskId).toBe('t1')
    expect((states[0] as { orphanAlertCount: number }).orphanAlertCount).toBe(1)
  })

  it('does not flag descendants of shells that were never killed', async () => {
    resetSpawnLedgerForTests()
    resetOrphanWatchdogForTests()
    recordSpawn({
      taskId: 't2',
      shellPid: 100,
      command: 'sleep 5',
      description: 'sleep',
      startedAt: 0,
    })
    // Still running — no killedAt — so a census containing its children is fine.
    const snapshot = async (): Promise<ProcessInfo[]> => [
      proc(100, 1, 'bash'),
      proc(200, 100, 'sleep'),
    ]

    const count = await runOrphanWatchdogTick({ snapshot })

    expect(count).toBe(0)
    expect(getOrphanSuspects()).toEqual([])
  })

  it('drops the count back to zero after all orphans are resolved', async () => {
    resetSpawnLedgerForTests()
    resetOrphanWatchdogForTests()
    recordSpawn({
      taskId: 't3',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t3', [proc(200, 100, 'tail'), proc(300, 200, 'grep')])
    recordOrphans('t3', [proc(300, 1, 'grep')])

    const before = await runOrphanWatchdogTick({
      snapshot: async () => [proc(300, 1, 'grep')],
    })
    expect(before).toBe(1)

    // User kills the orphan manually — re-census confirms it is gone.
    clearOrphans('t3', [300])
    const after = await runOrphanWatchdogTick({ snapshot: async () => [] })
    expect(after).toBe(0)
    expect(getOrphanSuspects()).toEqual([])
  })

  it('self-heals: drops recorded orphans that died on their own, keeps live ones', async () => {
    resetSpawnLedgerForTests()
    resetOrphanWatchdogForTests()
    recordSpawn({
      taskId: 't4',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t4', [proc(200, 100, 'tail'), proc(300, 200, 'grep')])
    recordOrphans('t4', [proc(300, 1, 'grep'), proc(400, 1, 'tee')])

    // 300 is still alive, 400 died on its own — the watchdog clears 400 only.
    const count = await runOrphanWatchdogTick({
      snapshot: async () => [proc(300, 1, 'grep')],
    })
    expect(count).toBe(1)
    expect(getOrphanSuspects().map((s) => s.orphan.pid).sort()).toEqual([300])
  })

  it('does not clear recorded orphans on an empty (transient-failure) census', async () => {
    resetSpawnLedgerForTests()
    resetOrphanWatchdogForTests()
    recordSpawn({
      taskId: 't5',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t5', [proc(200, 100, 'tail'), proc(300, 200, 'grep')])
    recordOrphans('t5', [proc(300, 1, 'grep')])

    // Empty census (enumeration failure) must not wipe a live recorded orphan.
    const count = await runOrphanWatchdogTick({ snapshot: async () => [] })
    expect(count).toBe(1)
    expect(getOrphanSuspects()).toHaveLength(1)
  })
})
