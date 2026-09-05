import { describe, expect, it, beforeEach } from 'bun:test'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'
import { setModelRegistryCachePathOverrideForTesting } from '../../utils/model/modelRegistryCache.js'
import {
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

  it('indexes devModelsCatalog for both models.json and api.json schemas', () => {
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

    // Match by parsed base name
    expect(index['apertus-8b']?.context_limit).toBe(65536)
    expect(index['apertus-8b']?.supports_reasoning).toBe(false)
    expect(index['apertus-8b']?.supports_tools).toBe(true)

    // Match by full id
    expect(index['meituan/longcat-2.0']?.context_limit).toBe(1000000)
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

  it('runs discovery, enriches exclusively router models, and updates ModelRegistry', async () => {
    const mockRouterResponse = {
      data: [
        { id: 'oc/big-pickle' },
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
    expect(bigPickle?.context_window).toBe(128000)
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
    expect(ModelRegistry.getModel('oc/big-pickle')?.context_window).toBe(128000)
  })
})
