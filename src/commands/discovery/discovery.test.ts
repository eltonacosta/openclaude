import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'
import { setModelRegistryCachePathOverrideForTesting } from '../../utils/model/modelRegistryCache.js'
import { setOrbitConfigPathOverrideForTesting } from '../../utils/orbitConfig.js'
import { call } from './discovery.js'
import type { LocalJSXCommandContext } from '../../commands.js'

describe('discovery command', () => {
  beforeEach(() => {
    setModelRegistryCachePathOverrideForTesting('/nonexistent/cache/path.json')
    ModelRegistry.clear()
    setOrbitConfigPathOverrideForTesting('/nonexistent/path/config.json')
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    setOrbitConfigPathOverrideForTesting(undefined)
    setModelRegistryCachePathOverrideForTesting(undefined)
  })

  it('returns instructions when no Orbit Router config is found', async () => {
    const result = await call('', {} as LocalJSXCommandContext)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('No Orbit Router configuration found')
      expect(result.value).toContain('/login <API_URL> <API_KEY>')
    }
  })

  it('executes discovery when credentials are in environment and returns formatted text', async () => {
    process.env.OPENAI_BASE_URL = 'https://ai.servhub.xyz/v1'
    process.env.OPENAI_API_KEY = 'sk-fake-key'

    // Mock global fetch to return router models and models.dev
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
      const result = await call('', {} as LocalJSXCommandContext)
      expect(result.type).toBe('text')
      if (result.type === 'text') {
        expect(result.value).toContain('Descoberta concluída a partir de https://ai.servhub.xyz/v1')
        expect(result.value).toContain('1 modelos atualizados ou adicionados')
        expect(result.value).toContain('Total de modelos disponíveis (/v1/models): 1')
      }

      // Second run without changes should report 0 modelos atualizados ou adicionados
      const secondResult = await call('', {} as LocalJSXCommandContext)
      expect(secondResult.type).toBe('text')
      if (secondResult.type === 'text') {
        expect(secondResult.value).toContain('0 modelos atualizados ou adicionados')
      }

      expect(ModelRegistry.hasModels()).toBe(true)
      expect(ModelRegistry.getModel('oc/big-pickle')?.context_window).toBe(1000000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
