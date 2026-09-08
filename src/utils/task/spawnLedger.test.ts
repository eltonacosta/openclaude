import { describe, expect, it } from 'bun:test'
import {
  clearOrphans,
  getAllLedgerEntries,
  getLedgerEntry,
  getOrphanSuspects,
  markKillStart,
  recordOrphans,
  recordSpawn,
  removeLedgerEntry,
  resetSpawnLedgerForTests,
} from './spawnLedger.js'
import type { ProcessInfo } from '../processCensus.js'

const proc = (pid: number, ppid: number, name: string): ProcessInfo => ({
  pid,
  ppid,
  name,
  memoryBytes: pid * 1000,
})

const spawn = (taskId = 'task_1') =>
  recordSpawn({
    taskId,
    shellPid: 100,
    command: 'tail -f x | grep y',
    description: 'watch log',
    kind: 'monitor',
    startedAt: 111,
    outputPath: `/tmp/${taskId}.output`,
  })

describe('spawnLedger', () => {
  it('records spawns and retrieves entries', () => {
    resetSpawnLedgerForTests()
    spawn()
    const entry = getLedgerEntry('task_1')
    expect(entry).toMatchObject({
      taskId: 'task_1',
      shellPid: 100,
      command: 'tail -f x | grep y',
      startedAt: 111,
      outputPath: '/tmp/task_1.output',
    })
    expect(entry?.killedAt).toBeUndefined()
    expect(getAllLedgerEntries()).toHaveLength(1)
  })

  it('markKillStart stores the pre-kill census, recordOrphans accumulates deduped survivors', () => {
    resetSpawnLedgerForTests()
    spawn()
    const census = [proc(200, 100, 'tail.exe'), proc(300, 200, 'grep.exe')]
    markKillStart('task_1', census)
    expect(getLedgerEntry('task_1')?.killedAt).toBeDefined()
    expect(getLedgerEntry('task_1')?.capturedDescendants).toEqual(census)

    const survivors = [proc(300, 200, 'grep.exe')]
    recordOrphans('task_1', survivors)
    recordOrphans('task_1', survivors) // duplicate pid must not be appended twice
    expect(getLedgerEntry('task_1')?.orphans).toEqual(survivors)

    const entry = getLedgerEntry('task_1')!
    expect(getOrphanSuspects()).toEqual([
      { entry, orphan: survivors[0] },
    ])
  })

  it('ignores unknown task ids', () => {
    resetSpawnLedgerForTests()
    markKillStart('nope', [proc(1, 0, 'x')])
    recordOrphans('nope', [proc(1, 0, 'x')])
    expect(getOrphanSuspects()).toEqual([])
  })

  it('ledger survives "eviction" — entries persist until explicitly removed', () => {
    resetSpawnLedgerForTests()
    spawn('task_2')
    // Simulate evictTaskOutput: the registry/disk output is gone but the
    // module-level ledger still holds the spawn record.
    expect(getLedgerEntry('task_2')).toBeDefined()
    removeLedgerEntry('task_2')
    expect(getLedgerEntry('task_2')).toBeUndefined()
  })

  it('clearOrphans removes resolved pids and drops the entry when fully resolved', () => {
    resetSpawnLedgerForTests()
    spawn('task_3')
    markKillStart('task_3', [proc(200, 100, 'tail.exe')])
    recordOrphans('task_3', [proc(300, 200, 'grep.exe'), proc(400, 200, 'tee.exe')])
    clearOrphans('task_3', [300])
    const entry = getLedgerEntry('task_3')
    expect(entry?.orphans?.map((o) => o.pid)).toEqual([400])
    clearOrphans('task_3', [400])
    expect(getLedgerEntry('task_3')).toBeUndefined()
    expect(getOrphanSuspects()).toEqual([])
  })
})
