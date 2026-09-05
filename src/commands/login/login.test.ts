import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { call } from './login.js'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { loadOrbitConfig, setOrbitConfigPathOverrideForTesting } from '../../utils/orbitConfig.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

describe('login command with Orbit Router arguments', () => {
  const testConfigPath = join(tmpdir(), `orbit-login-test-${Date.now()}.json`)

  beforeEach(() => {
    ModelRegistry.clear()
    setOrbitConfigPathOverrideForTesting(testConfigPath)
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.CLAUDE_CODE_USE_OPENAI
  })

  afterEach(() => {
    setOrbitConfigPathOverrideForTesting(undefined)
    try {
      rmSync(testConfigPath, { force: true })
    } catch {}
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.CLAUDE_CODE_USE_OPENAI
  })

  it('shows usage instructions when called with insufficient arguments', async () => {
    let resultMessage = ''
    const mockOnDone = (msg?: string) => {
      resultMessage = msg || ''
    }

    const mockContext = {} as LocalJSXCommandContext
    const jsx = await call(mockOnDone, mockContext, 'https://ai.servhub.xyz/v1')

    expect(jsx).toBeNull()
    expect(resultMessage).toContain('Usage: /login <API_URL> <API_KEY>')
  })

  it('saves credentials, triggers discovery, and reports success on valid arguments', async () => {
    let resultMessage = ''
    const mockOnDone = (msg?: string) => {
      resultMessage = msg || ''
    }

    let appState: any = { authVersion: 1, mainLoopModel: undefined }
    const mockContext = {
      onChangeAPIKey: () => {},
      setMessages: () => {},
      setAppState: (updater: any) => {
        appState = typeof updater === 'function' ? updater(appState) : updater
      },
    } as unknown as LocalJSXCommandContext

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('models.dev')) {
        return new Response(
          JSON.stringify({
            'big-pickle': {
              id: 'big-pickle',
              name: 'Big Pickle',
              limit: { context: 1000000 },
              reasoning: true,
              tool_call: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          data: [{ id: 'oc/big-pickle' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const jsx = await call(
        mockOnDone,
        mockContext,
        'https://ai.servhub.xyz/v1 sk-test-orbit-key',
      )

      expect(jsx).toBeNull()
      expect(resultMessage).toContain('Orbit Router login successful!')
      expect(resultMessage).toContain('https://ai.servhub.xyz/v1')
      expect(resultMessage).toContain('1 modelos atualizados ou adicionados')

      // Check process.env was updated
      expect(process.env.OPENAI_BASE_URL).toBe('https://ai.servhub.xyz/v1')
      expect(process.env.OPENAI_API_KEY).toBe('sk-test-orbit-key')
      expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')

      // Check config file was saved
      const loaded = loadOrbitConfig()
      expect(loaded?.api_url).toBe('https://ai.servhub.xyz/v1')
      expect(loaded?.api_key).toBe('sk-test-orbit-key')

      // Check model registry was updated
      expect(ModelRegistry.hasModels()).toBe(true)
      expect(ModelRegistry.getModel('oc/big-pickle')?.displayName).toBe('big-pickle')

      // Check appState model selection
      expect(appState.mainLoopModel).toBe('oc/big-pickle')
      expect(appState.authVersion).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
