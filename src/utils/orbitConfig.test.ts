import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadOrbitConfig,
  normalizeRouterUrl,
  saveOrbitConfig,
  applyOrbitConfigToEnv,
} from './orbitConfig.js'

describe('orbitConfig', () => {
  const testDir = join(tmpdir(), `orbit-test-${Date.now()}`)
  const testConfigPath = join(testDir, 'config.json')

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.CLAUDE_CODE_USE_OPENAI
  })

  it('normalizes URLs by stripping trailing slashes and whitespace', () => {
    expect(normalizeRouterUrl('https://ai.servhub.xyz/v1/')).toBe(
      'https://ai.servhub.xyz/v1',
    )
    expect(normalizeRouterUrl('  https://ai.servhub.xyz/v1///  ')).toBe(
      'https://ai.servhub.xyz/v1',
    )
  })

  it('saves and loads Orbit Router configuration', () => {
    const saved = saveOrbitConfig(
      'https://ai.servhub.xyz/v1/',
      'sk-test-key-12345',
      testConfigPath,
    )

    expect(saved.api_url).toBe('https://ai.servhub.xyz/v1')
    expect(saved.router_url).toBe('https://ai.servhub.xyz/v1')
    expect(saved.api_key).toBe('sk-test-key-12345')

    const loaded = loadOrbitConfig(testConfigPath)
    expect(loaded).not.toBeNull()
    expect(loaded?.api_url).toBe('https://ai.servhub.xyz/v1')
    expect(loaded?.router_url).toBe('https://ai.servhub.xyz/v1')
    expect(loaded?.api_key).toBe('sk-test-key-12345')

    expect(process.env.OPENAI_BASE_URL).toBe('https://ai.servhub.xyz/v1')
    expect(process.env.OPENAI_API_KEY).toBe('sk-test-key-12345')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  })

  it('preserves other existing configuration fields in config.json', () => {
    writeFileSync(
      testConfigPath,
      JSON.stringify({ customSetting: 'preserved', other: 42 }, null, 2),
      'utf8',
    )

    saveOrbitConfig(
      'https://router.example.com/v1',
      'sk-secret',
      testConfigPath,
    )

    const loaded = loadOrbitConfig(testConfigPath)
    expect(loaded?.api_key).toBe('sk-secret')

    const raw = JSON.parse(require('node:fs').readFileSync(testConfigPath, 'utf8'))
    expect(raw.customSetting).toBe('preserved')
    expect(raw.other).toBe(42)
    expect(raw.orbit_router.api_url).toBe('https://router.example.com/v1')
  })

  it('returns null when config file does not exist or has no orbit_router block', () => {
    expect(loadOrbitConfig(join(testDir, 'nonexistent.json'))).toBeNull()

    writeFileSync(testConfigPath, JSON.stringify({ other: true }), 'utf8')
    expect(loadOrbitConfig(testConfigPath)).toBeNull()
  })

  it('applies configuration to process.env via applyOrbitConfigToEnv', () => {
    applyOrbitConfigToEnv({
      api_url: 'https://test.env/v1',
      router_url: 'https://test.env/v1',
      api_key: 'env-key',
    })

    expect(process.env.OPENAI_BASE_URL).toBe('https://test.env/v1')
    expect(process.env.OPENAI_API_KEY).toBe('env-key')
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  })
})
