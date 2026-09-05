import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRegistry } from './modelRegistry.js'
import {
  clearModelsCache,
  getModelRegistryCachePath,
  loadModelsCache,
  saveModelsCache,
  setModelRegistryCachePathOverrideForTesting,
} from './modelRegistryCache.js'

describe('modelRegistryCache', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'models-cache-test-'))
  const cachePath = join(tmpDir, 'models-cache.json')

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    setModelRegistryCachePathOverrideForTesting(cachePath)
    clearModelsCache()
  })

  afterEach(() => {
    setModelRegistryCachePathOverrideForTesting(undefined)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null when no cache file exists', () => {
    expect(loadModelsCache()).toBeNull()
  })

  it('persists models and reads them back', () => {
    const models = [
      {
        id: 'oc/big-pickle',
        displayName: 'big-pickle',
        context_window: 128000,
        supports_efforts: true,
        supports_tools: true,
      },
    ]

    saveModelsCache(models, 'https://ai.servhub.xyz/v1')

    const cache = loadModelsCache()
    expect(cache).not.toBeNull()
    expect(cache?.apiUrl).toBe('https://ai.servhub.xyz/v1')
    expect(cache?.models).toHaveLength(1)
    expect(cache?.models[0]?.id).toBe('oc/big-pickle')
  })

  it('refuses to write an empty model list (protects known-good cache)', () => {
    saveModelsCache([], 'https://ai.servhub.xyz/v1')
    expect(existsSync(cachePath)).toBe(false)
    expect(loadModelsCache()).toBeNull()
  })

  it('treats corrupt JSON as no usable cache', () => {
    saveModelsCache(
      [
        {
          id: 'oc/x',
          displayName: 'x',
          context_window: 4096,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1',
    )
    // Overwrite with garbage
    writeFileSync(cachePath, '{{{ not json')

    expect(loadModelsCache()).toBeNull()
  })

  it('treats wrong-version or malformed cache as no usable cache', () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 999, savedAt: 'x', apiUrl: 'x', models: [] }),
    )
    expect(loadModelsCache()).toBeNull()
  })

  it('clearModelsCache removes the file', () => {
    saveModelsCache(
      [
        {
          id: 'oc/x',
          displayName: 'x',
          context_window: 4096,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1',
    )
    expect(existsSync(cachePath)).toBe(true)
    clearModelsCache()
    expect(existsSync(cachePath)).toBe(false)
    expect(loadModelsCache()).toBeNull()
  })
})

describe('ModelRegistry persistence integration', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'registry-cache-test-'))
  const cachePath = join(tmpDir, 'models-cache.json')

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    setModelRegistryCachePathOverrideForTesting(cachePath)
    ModelRegistry.clear()
  })

  afterEach(() => {
    setModelRegistryCachePathOverrideForTesting(undefined)
    ModelRegistry.clear()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists on updateModels when apiUrl is provided', () => {
    ModelRegistry.updateModels(
      [
        {
          id: 'oc/pickle',
          displayName: 'pickle',
          context_window: 8192,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1',
    )

    expect(existsSync(cachePath)).toBe(true)
    expect(loadModelsCache()?.models).toHaveLength(1)
  })

  it('does not persist when apiUrl is omitted (in-memory only)', () => {
    ModelRegistry.updateModels([
      {
        id: 'oc/pickle',
        displayName: 'pickle',
        context_window: 8192,
        supports_efforts: false,
        supports_tools: true,
      },
    ])

    expect(existsSync(cachePath)).toBe(false)
  })

  it('hydrates from cache on loadFromCache with matching apiUrl', () => {
    const models = [
      {
        id: 'oc/hydrated',
        displayName: 'hydrated',
        context_window: 65536,
        supports_efforts: true,
        supports_tools: true,
      },
    ]
    saveModelsCache(models, 'https://ai.servhub.xyz/v1')

    const loaded = ModelRegistry.loadFromCache('https://ai.servhub.xyz/v1')
    expect(loaded).toBe(true)
    expect(ModelRegistry.hasModels()).toBe(true)
    expect(ModelRegistry.getModel('oc/hydrated')?.context_window).toBe(65536)
    expect(ModelRegistry.getCachedApiUrl()).toBe('https://ai.servhub.xyz/v1')
  })

  it('refuses to load when apiUrl does not match the cached router', () => {
    saveModelsCache(
      [
        {
          id: 'oc/other',
          displayName: 'other',
          context_window: 4096,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://other.router/v1',
    )

    const loaded = ModelRegistry.loadFromCache('https://ai.servhub.xyz/v1')
    expect(loaded).toBe(false)
    expect(ModelRegistry.hasModels()).toBe(false)
  })

  it('ignores trailing slashes when matching apiUrl', () => {
    saveModelsCache(
      [
        {
          id: 'oc/hydrated',
          displayName: 'hydrated',
          context_window: 65536,
          supports_efforts: true,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1/',
    )

    expect(ModelRegistry.loadFromCache('https://ai.servhub.xyz/v1')).toBe(true)
  })

  it('loadFromCache returns false when no cache exists', () => {
    expect(ModelRegistry.loadFromCache('https://ai.servhub.xyz/v1')).toBe(false)
  })

  it('clears the persisted cache on ModelRegistry.clear()', () => {
    ModelRegistry.updateModels(
      [
        {
          id: 'oc/pickle',
          displayName: 'pickle',
          context_window: 8192,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1',
    )
    expect(existsSync(cachePath)).toBe(true)

    ModelRegistry.clear()
    expect(existsSync(cachePath)).toBe(false)
    expect(loadModelsCache()).toBeNull()
  })

  it('produces a valid cache file on disk (readable JSON)', () => {
    ModelRegistry.updateModels(
      [
        {
          id: 'oc/roundtrip',
          displayName: 'roundtrip',
          context_window: 32768,
          supports_efforts: false,
          supports_tools: true,
        },
      ],
      'https://ai.servhub.xyz/v1',
    )

    const raw = readFileSync(cachePath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(parsed.apiUrl).toBe('https://ai.servhub.xyz/v1')
    expect(parsed.models[0]?.id).toBe('oc/roundtrip')
  })
})