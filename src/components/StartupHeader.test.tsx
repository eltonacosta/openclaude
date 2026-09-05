import { PassThrough } from 'node:stream'

import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { createRoot } from '../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { StartupHeader } from './StartupHeader.js'

await acquireSharedMutationLock('components/StartupHeader.test.tsx')

afterAll(() => {
  releaseSharedMutationLock()
})

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  getOutput: () => string
} {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return {
    stdout,
    stdin,
    getOutput: () => output,
  }
}

describe('StartupHeader', () => {
  test('renders brand, tagline, model, and version', async () => {
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.32.0' }
    const { stdout, stdin, getOutput } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })
    root.render(<StartupHeader />)
    await Bun.sleep(100)
    const frame = stripAnsi(getOutput())
    expect(frame).toContain('ORBIT CODE')
    expect(frame).toContain('Orbit terminal for any LLM')
    expect(frame).toContain('oc v0.32.0')
    root.unmount()
  })
})
