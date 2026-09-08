import { describe, expect, it } from 'bun:test'
import {
  findAlive,
  getDescendants,
  parseCimDate,
  parseDarwinPsOutput,
  parseProcStat,
  parsePsEtime,
  parseWin32CensusJson,
  type ProcessInfo,
} from './processCensus.js'

const proc = (
  pid: number,
  ppid: number,
  name: string,
  extra: Partial<ProcessInfo> = {},
): ProcessInfo => ({ pid, ppid, name, ...extra })

describe('getDescendants', () => {
  it('finds transitive descendants of a pipeline (shell -> tail -> grep)', () => {
    const table = [
      proc(1, 0, 'init'),
      proc(100, 1, 'bash.exe', { commandLine: 'bash -c "tail -f x | grep y"' }),
      proc(200, 100, 'tail.exe'),
      proc(300, 200, 'grep.exe', { memoryBytes: 20_000_000_000 }),
      proc(400, 1, 'unrelated.exe'),
    ]
    const descendants = getDescendants(table, 100)
    expect(descendants.map((p) => p.pid).sort()).toEqual([200, 300])
  })

  it('is cycle-safe', () => {
    const table = [
      proc(10, 20, 'a'),
      proc(20, 10, 'b'),
      proc(30, 10, 'c'),
    ]
    expect(getDescendants(table, 10).map((p) => p.pid).sort()).toEqual([20, 30])
    // With a 10<->20 cycle, traversal from 20 reaches 10 then 30 without looping forever.
    expect(getDescendants(table, 20).map((p) => p.pid).sort()).toEqual([10, 30])
  })

  it('does not include the root and returns empty when it has no children', () => {
    const table = [proc(1, 0, 'init'), proc(5, 1, 'other')]
    expect(getDescendants(table, 5)).toEqual([])
    expect(getDescendants(table, 999)).toEqual([])
  })

  it('cannot discover children re-parented to a dead intermediate pid', () => {
    // After the shell dies, the grandchild's ppid no longer chains back to root.
    const table = [
      proc(100, 1, 'bash.exe'),
      proc(300, 4999, 'grep.exe'), // re-parented to a pid not in the table
    ]
    expect(getDescendants(table, 100)).toEqual([])
  })
})

describe('findAlive', () => {
  it('returns matching rows in table order and deduplicates requested pids', () => {
    const table = [
      proc(300, 200, 'grep.exe', { memoryBytes: 1024 }),
      proc(100, 1, 'bash.exe'),
      proc(200, 100, 'tail.exe'),
    ]
    const alive = findAlive(table, [200, 300, 300, 999])
    expect(alive.map((p) => p.pid)).toEqual([300, 200])
    expect(alive[0]?.memoryBytes).toBe(1024)
  })

  it('returns empty when none of the pids are present', () => {
    expect(findAlive([proc(1, 0, 'init')], [7, 8])).toEqual([])
  })
})

describe('parseWin32CensusJson', () => {
  const row = {
    ProcessId: 300,
    ParentProcessId: 200,
    Name: 'grep.exe',
    CommandLine: 'grep --line-buffered -aiE pattern',
    WorkingSetSize: 20480000,
    CreationDate: '/Date(1662964800000)/',
  }

  it('parses an array of CIM process rows', () => {
    const table = parseWin32CensusJson(JSON.stringify([row, { ...row, ProcessId: 301 }]))
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({
      pid: 300,
      ppid: 200,
      name: 'grep.exe',
      commandLine: 'grep --line-buffered -aiE pattern',
      memoryBytes: 20480000,
      startedAtMs: 1662964800000,
    })
  })

  it('handles a single object result (ConvertTo-Json non-array form)', () => {
    const table = parseWin32CensusJson(JSON.stringify(row))
    expect(table).toHaveLength(1)
    expect(table[0]?.pid).toBe(300)
  })

  it('returns empty for invalid or empty output', () => {
    expect(parseWin32CensusJson('')).toEqual([])
    expect(parseWin32CensusJson('not json {')).toEqual([])
    expect(parseWin32CensusJson('null')).toEqual([])
  })

  it('tolerates null command lines and dates', () => {
    const table = parseWin32CensusJson(
      JSON.stringify([{ ProcessId: 4, ParentProcessId: 0, Name: 'System', CommandLine: null, WorkingSetSize: null, CreationDate: null }]),
    )
    expect(table[0]).toMatchObject({ pid: 4, name: 'System' })
    expect(table[0]?.commandLine).toBeUndefined()
    expect(table[0]?.memoryBytes).toBeUndefined()
    expect(table[0]?.startedAtMs).toBeUndefined()
  })
})

describe('parseCimDate', () => {
  it('parses /Date(ms)/ and ISO strings and rejects garbage', () => {
    expect(parseCimDate('/Date(1662964800000)/')).toBe(1662964800000)
    expect(parseCimDate('/Date(1662964800000)-0400/')).toBe(1662964800000)
    expect(parseCimDate('2022-09-12T08:00:00Z')).toBe(Date.parse('2022-09-12T08:00:00Z'))
    expect(parseCimDate('nonsense')).toBeUndefined()
    expect(parseCimDate(1234)).toBe(1234)
  })
})

describe('parseProcStat', () => {
  // Builds a /proc/<pid>/stat line with exact field positions:
  // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt
  // cmajflt utime stime cutime cstime priority nice threads itreal starttime vsize rss
  const makeStat = (pid: number, comm: string, ppid: number, starttime: number, rss: number) =>
    [
      String(pid),
      `(${comm})`,
      'S',
      String(ppid),
      '1', // pgrp
      '0', // session
      '0', // tty
      '1', // tpgid
      '0', // flags
      '0', // minflt
      '0', // cminflt
      '0', // majflt
      '0', // cmajflt
      '0', // utime
      '0', // stime
      '0', // cutime
      '0', // cstime
      '20', // priority
      '0', // nice
      '1', // threads
      '0', // itrealvalue
      String(starttime),
      '52428800', // vsize
      String(rss),
    ].join(' ')

  it('extracts ppid, starttime, rss and comm paren-aware', () => {
    const parsed = parseProcStat(makeStat(92056, 'grep', 92000, 12345, 12800))
    expect(parsed).toMatchObject({
      ppid: 92000,
      starttime: 12345,
      rssPages: 12800,
      comm: 'grep',
    })
  })

  it('handles comm values containing spaces and parentheses', () => {
    const parsed = parseProcStat(makeStat(12, 'Web Content (tab)', 1, 99, 10))
    expect(parsed?.comm).toBe('Web Content (tab)')
    expect(parsed?.ppid).toBe(1)
    expect(parsed?.starttime).toBe(99)
    expect(parsed?.rssPages).toBe(10)
  })

  it('returns undefined for malformed content', () => {
    expect(parseProcStat('no parens here')).toBeUndefined()
    expect(parseProcStat('12 (trunc')).toBeUndefined()
  })
})

describe('parsePsEtime', () => {
  it('parses [[dd-]hh:]mm:ss forms', () => {
    expect(parsePsEtime('05')).toBeUndefined() // invalid
    expect(parsePsEtime('00:05')).toBe(5)
    expect(parsePsEtime('01:02:03')).toBe(3723)
    expect(parsePsEtime('1-02:03:04')).toBe(93784)
  })
})

describe('parseDarwinPsOutput', () => {
  it('parses fixed-column ps output with command lines and rss in KB', () => {
    const out = [
      '  92056 92000 12800 00:05 grep --line-buffered -aiE pattern',
      '    123     1  2048 1-02:03:04 /usr/bin/tail -f big.log',
      '',
    ].join('\n')
    const table = parseDarwinPsOutput(out, 1_000_000_000_000)
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({
      pid: 92056,
      ppid: 92000,
      name: 'grep',
      commandLine: 'grep --line-buffered -aiE pattern',
      memoryBytes: 12800 * 1024,
      startedAtMs: 1_000_000_000_000 - 5_000,
    })
    expect(table[1]).toMatchObject({
      pid: 123,
      name: 'tail',
      memoryBytes: 2048 * 1024,
      startedAtMs: 1_000_000_000_000 - 93784_000,
    })
  })

  it('skips malformed lines', () => {
    expect(parseDarwinPsOutput('garbage line\n\n')).toEqual([])
  })
})
