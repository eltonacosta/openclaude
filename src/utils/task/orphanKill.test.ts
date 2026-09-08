import { describe, expect, it } from 'bun:test'
import {
  killOrphanProcess,
  namesMatch,
} from './orphanKill.js'
import {
  getOrphanSuspects,
  markKillStart,
  recordOrphans,
  recordSpawn,
  resetSpawnLedgerForTests,
} from './spawnLedger.js'
import type { ProcessInfo } from '../processCensus.js'

const proc = (pid: number, ppid: number, name: string): ProcessInfo => ({
  pid,
  ppid,
  name,
})

// Snapshot sequence: each call to the injected snapshot returns the next table.
function sequenceSnapshots(tables: ProcessInfo[][]): () => Promise<ProcessInfo[]> {
  let i = 0
  return async () => tables[Math.min(i++, tables.length - 1)]!
}

// Real 400ms sleep so the confirm-poll loop doesn't spin the CPU at full
// speed between snapshots (killOrphanProcess's deadline uses real time).
const pollSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('namesMatch', () => {
  it('matches exact, case-insensitive, and .exe-stripped names', () => {
    expect(namesMatch('grep', 'grep')).toBe(true)
    expect(namesMatch('GREP.EXE', 'grep')).toBe(true)
    expect(namesMatch('grep.exe', 'grep.exe')).toBe(true)
    expect(namesMatch('tail', 'grep')).toBe(false)
  })

  it('matches substring containment both ways', () => {
    expect(namesMatch('grep.exe', 'gre')).toBe(true)
    expect(namesMatch('node.exe (vite)', 'node')).toBe(true)
    expect(namesMatch('a', 'abcdef')).toBe(true)
  })

  it('returns false for undefined live name', () => {
    expect(namesMatch(undefined, 'grep')).toBe(false)
  })
})

describe('killOrphanProcess', () => {
  it("reports 'already-gone' and clears the ledger when the pid is dead", async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't1',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t1', [proc(200, 100, 'tail')])
    recordOrphans('t1', [proc(300, 1, 'grep')])
    expect(getOrphanSuspects()).toHaveLength(1)

    const result = await killOrphanProcess(300, 'grep', {
      snapshot: async () => [],
      sleep: pollSleep,
    })

    expect(result).toBe('already-gone')
    expect(getOrphanSuspects()).toEqual([])
  })

  it("refuses to kill on 'name-mismatch' (pid reuse protection)", async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't2',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t2', [proc(200, 100, 'tail')])
    recordOrphans('t2', [proc(300, 1, 'grep')])

    // Pid 300 was recycled by an unrelated process.
    const result = await killOrphanProcess(300, 'grep', {
      snapshot: async () => [proc(300, 1, 'svchost')],
      sleep: pollSleep,
    })

    expect(result).toBe('name-mismatch')
    expect(getOrphanSuspects()).toHaveLength(1)
  })

  it("reports 'killed' and clears the ledger when the process dies", async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't3',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t3', [proc(200, 100, 'tail')])
    recordOrphans('t3', [proc(300, 1, 'grep')])

    const result = await killOrphanProcess(300, 'grep', {
      snapshot: sequenceSnapshots([
        [proc(300, 1, 'grep')],
        [],
      ]),
      sleep: pollSleep,
    })

    expect(result).toBe('killed')
    expect(getOrphanSuspects()).toEqual([])
  })

  it("reports 'survived' and keeps the ledger entry when the kill fails", async () => {
    resetSpawnLedgerForTests()
    recordSpawn({
      taskId: 't4',
      shellPid: 100,
      command: 'tail -f x | grep y',
      description: 'watch',
      startedAt: 0,
    })
    markKillStart('t4', [proc(200, 100, 'tail')])
    recordOrphans('t4', [proc(300, 1, 'grep')])

    const result = await killOrphanProcess(300, 'grep', {
      snapshot: async () => [proc(300, 1, 'grep')],
      sleep: pollSleep,
    })

    expect(result).toBe('survived')
    expect(getOrphanSuspects()).toHaveLength(1)
  })
})
