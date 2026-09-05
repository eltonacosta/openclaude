import { PassThrough } from 'node:stream'

import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { createRoot } from '../ink.js'
import { AppStateProvider } from '../state/AppState.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { hasOrbitCredentials, OrbitRouterSetup } from './OrbitRouterSetup.js'

await acquireSharedMutationLock('components/OrbitRouterSetup.test.tsx')

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

describe('OrbitRouterSetup', () => {
  test('renders the URL step first', async () => {
    const { stdout, stdin, getOutput } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })
    root.render(
      <AppStateProvider>
        <OrbitRouterSetup onDone={() => {}} />
      </AppStateProvider>,
    )
    await Bun.sleep(100)
    const frame = stripAnsi(getOutput())
    expect(frame).toContain('Welcome to Orbit Code')
    expect(frame).toContain('API URL')
    root.unmount()
  })
})

describe('hasOrbitCredentials', () => {
  test('returns false without env or stored config', async () => {
    const savedBase = process.env.OPENAI_BASE_URL
    const savedKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    try {
      const { setOrbitConfigPathOverrideForTesting } = await import(
        '../utils/orbitConfig.js'
      )
      setOrbitConfigPathOverrideForTesting('/nonexistent/orbit-config.json')
      expect(hasOrbitCredentials()).toBe(false)
      setOrbitConfigPathOverrideForTesting(undefined)
    } finally {
      if (savedBase !== undefined) process.env.OPENAI_BASE_URL = savedBase
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey
    }
  })

  test('ignores env credentials without a stored config', async () => {
    // Env vars are replayed from settings before the boot gate runs, so they
    // must not satisfy the gate on their own — otherwise stale env skips the
    // mandatory first-boot setup.
    const savedBase = process.env.OPENAI_BASE_URL
    const savedKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_BASE_URL = 'https://router.example.test/v1'
    process.env.OPENAI_API_KEY = 'sk-test'
    const { setOrbitConfigPathOverrideForTesting } = await import(
      '../utils/orbitConfig.js'
    )
    setOrbitConfigPathOverrideForTesting('/nonexistent/orbit-config.json')
    try {
      expect(hasOrbitCredentials()).toBe(false)
    } finally {
      setOrbitConfigPathOverrideForTesting(undefined)
      if (savedBase !== undefined) process.env.OPENAI_BASE_URL = savedBase
      else delete process.env.OPENAI_BASE_URL
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey
      else delete process.env.OPENAI_API_KEY
    }
  })
})
