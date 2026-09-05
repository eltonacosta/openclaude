import { describe, expect, it, afterEach, beforeEach } from 'bun:test'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'
import { setModelRegistryCachePathOverrideForTesting } from '../../utils/model/modelRegistryCache.js'
import {
  extractDevEffortLevels,
  fetchRouterModels,
  indexDevModelsCatalog,
  runDiscovery,
  type FetchLike,
} from './orbitDiscovery.js'

describe('orbitDiscovery', () => {
  beforeEach(() => {
    setModelRegistryCachePathOverrideForTesting('/nonexistent/cache/path.json')
    ModelRegistry.clear()
  })

  afterEach(() => {
    ModelRegistry.clear()
    setModelRegistryCachePathOverrideForTesting(undefined)
  })

  it('indexes effort metadata from both models.json and api.json schemas', () => {
    const modelsJsonSample = {
      'swiss-ai/apertus-8b': {
        id: 'swiss-ai/apertus-8b',
        name: 'Apertus 8B',
        reasoning: false,
        tool_call: true,
        limit: { context: 65536, output: 8192 },
      },
      'meituan/longcat-2.0': {
        id: 'meituan/longcat-2.0',
        name: 'LongCat-2.0',
        reasoning: true,
        tool_call: true,
        limit: { context: 1000000, output: 131072 },
      },
    }

    const index = indexDevModelsCatalog(modelsJsonSample)

    expect(index['apertus-8b']?.supports_reasoning).toBe(false)
    expect(index['apertus-8b']).not.toHaveProperty('context_limit')
    expect(index['apertus-8b']).not.toHaveProperty('supports_tools')
    expect(index['meituan/longcat-2.0']?.supports_reasoning).toBe(true)
    expect(index['longcat-2.0']?.supports_reasoning).toBe(true)
  })

  it('fetches router models with Authorization Bearer header', async () => {
    let capturedUrl = ''
    let capturedAuthHeader = ''

    const mockFetch: FetchLike = async (input, init) => {
      capturedUrl = String(input)
      const headers = init?.headers as Record<string, string>
      capturedAuthHeader = headers?.Authorization || ''

      return new Response(
        JSON.stringify({
          data: [
            { id: 'oc/big-pickle' },
            { id: 'oc/cucumber' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const models = await fetchRouterModels(
      'https://ai.servhub.xyz/v1',
      'sk-secret-key',
      mockFetch,
    )

    expect(capturedUrl).toBe('https://ai.servhub.xyz/v1/models')
    expect(capturedAuthHeader).toBe('Bearer sk-secret-key')
    expect(models).toHaveLength(2)
    expect(models[0]?.id).toBe('oc/big-pickle')
  })

  it('matches router variants to the longest models.dev effort entry', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            'gemini-3.8-flash': {
              id: 'gemini-3.8-flash',
              reasoning: true,
              tool_call: false,
              limit: { context: 131072 },
            },
            flash: {
              id: 'flash',
              reasoning: false,
              limit: { context: 4096 },
            },
          }
        : {
            data: [
              {
                id: 'agy/gemini-3.8-flash-high',
                context_window: 1000000,
                supports_tools: true,
              },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result[0]?.id).toBe('agy/gemini-3.8-flash-high')
    expect(result[0]?.context_window).toBe(1000000)
    expect(result[0]?.supports_efforts).toBe(true)
    expect(result[0]?.supports_tools).toBe(true)
  })

  it('enriches router IDs with provider prefixes from the models.dev catalog', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            'google/gemini-3.8-flash': {
              id: 'google/gemini-3.8-flash',
              name: 'Gemini 3.8 Flash',
              reasoning: true,
              tool_call: true,
              limit: { context: 1048576 },
            },
          }
        : {
            data: [
              {
                id: 'ag/gemini-3.8-flash-high',
                context_window: 1000000,
                supports_tools: false,
                description: 'Router deployment metadata',
              },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'ag/gemini-3.8-flash-high',
      displayName: 'gemini-3.8-flash-high',
      context_window: 1000000,
      supports_efforts: true,
      supports_tools: false,
      description: 'Router deployment metadata',
    })
    expect(ModelRegistry.getModels()[0]?.id).toBe('ag/gemini-3.8-flash-high')
  })
  it('uses models.dev only for effort support', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            'gpt-5.6-sol': {
              id: 'gpt-5.6-sol',
              reasoning: true,
              tool_call: true,
              limit: { context: 128000 },
            },
          }
        : {
            data: [
              {
                id: 'cx/gpt-5.6-sol',
                context_window: 1000000,
                supports_tools: false,
                description: 'Router deployment metadata',
              },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result[0]).toMatchObject({
      id: 'cx/gpt-5.6-sol',
      context_window: 1000000,
      supports_efforts: true,
      supports_tools: false,
      description: 'Router deployment metadata',
    })
    expect(
      ModelRegistry.getModel('cx/gpt-5.6-sol')?.context_window,
    ).toBe(1000000)
  })

  it('runs discovery, enriches exclusively router models, and updates ModelRegistry', async () => {
    const mockRouterResponse = {
      data: [
        { id: 'oc/big-pickle', context_window: 256000 },
        { id: 'oc/unregistered-model', context_window: 8192 },
      ],
    }

    const mockDevCatalog = {
      'big-pickle': {
        id: 'big-pickle',
        name: 'Big Pickle Model',
        reasoning: true,
        tool_call: true,
        limit: { context: 128000 },
      },
      'should-not-be-in-result': {
        id: 'should-not-be-in-result',
        limit: { context: 50000 },
      },
    }

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input)
      if (url.includes('models.dev')) {
        return new Response(JSON.stringify(mockDevCatalog), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(mockRouterResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    // Strictly 2 models from router
    expect(result).toHaveLength(2)

    // Check enriched model
    const bigPickle = result.find(m => m.id === 'oc/big-pickle')
    expect(bigPickle).toBeDefined()
    expect(bigPickle?.displayName).toBe('big-pickle')
    expect(bigPickle?.context_window).toBe(256000)
    expect(bigPickle?.supports_efforts).toBe(true)
    expect(bigPickle?.supports_tools).toBe(true)

    // Check unregistered model (safe fallbacks)
    const unreg = result.find(m => m.id === 'oc/unregistered-model')
    expect(unreg).toBeDefined()
    expect(unreg?.displayName).toBe('unregistered-model')
    expect(unreg?.context_window).toBe(8192) // from router model
    expect(unreg?.supports_efforts).toBe(false)
    expect(unreg?.supports_tools).toBe(true)

    // Ensure models.dev models NOT in router are NEVER added
    expect(result.some(m => m.id.includes('should-not-be-in-result'))).toBe(false)

    // Verify ModelRegistry in-memory state
    expect(ModelRegistry.hasModels()).toBe(true)
    expect(ModelRegistry.getModel('oc/big-pickle')?.context_window).toBe(256000)
  })

  it('reads the router context from OpenAI-compatible aliases and beats models.dev', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            'gpt-5.6-sol': {
              id: 'openai/gpt-5.6-sol',
              reasoning: true,
              tool_call: true,
              limit: { context: 1050000 },
            },
          }
        : {
            data: [
              { id: 'cx/gpt-5.6-sol', context_length: 400000 },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.context_window).toBe(400000)
    expect(result[0]?.supports_efforts).toBe(true)
    expect(ModelRegistry.getModel('cx/gpt-5.6-sol')?.context_window).toBe(400000)
  })

  it('reads effort support from router capabilities before models.dev', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            'deepseek-4-flash': {
              id: 'deepseek/deepseek-4-flash',
              reasoning: false,
              tool_call: true,
              limit: { context: 128000 },
            },
          }
        : {
            data: [
              {
                id: 'do/deepseek-4-flash',
                context_length: 128000,
                capabilities: { reasoning: true, tools: true },
              },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.supports_efforts).toBe(true)
    expect(result[0]?.supports_tools).toBe(true)
    expect(ModelRegistry.getModel('do/deepseek-4-flash')?.supports_efforts).toBe(true)
  })

  it('falls back to 4096 when the router omits or zeroes context_window', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {}
        : {
            data: [
              { id: 'oc/zero-window', context_window: 0 },
              { id: 'oc/no-window' },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result).toHaveLength(2)
    expect(result[0]?.context_window).toBe(4096)
    expect(result[1]?.context_window).toBe(4096)
    expect(result[0]?.supports_efforts).toBe(false)
    expect(ModelRegistry.getModel('oc/zero-window')?.context_window).toBe(4096)
  })

  it('extracts configurable effort levels from reasoning_options', () => {
    expect(
      extractDevEffortLevels({
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
      }),
    ).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(extractDevEffortLevels({ reasoning: true })).toEqual([])
    expect(extractDevEffortLevels(undefined)).toEqual([])
  })

  it('prefers the canonical provider entry when the router prefix differs', async () => {
    const mockFetch: FetchLike = async input => {
      const url = String(input)
      const payload = url.includes('models.dev')
        ? {
            openai: {
              models: {
                'gpt-5.6-sol': {
                  id: 'gpt-5.6-sol',
                  reasoning: true,
                  reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
                  limit: { context: 1050000 },
                },
              },
            },
          }
        : {
            data: [
              { id: 'cx/gpt-5.6-sol', context_length: 400000 },
            ],
          }

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runDiscovery(
      'https://ai.servhub.xyz/v1',
      'sk-test',
      { fetchFn: mockFetch },
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.supports_efforts).toBe(true)
    expect(result[0]?.effort_levels).toEqual(['low', 'medium', 'high'])
    expect(ModelRegistry.getModel('cx/gpt-5.6-sol')?.effort_levels).toEqual(['low', 'medium', 'high'])
  })
})
