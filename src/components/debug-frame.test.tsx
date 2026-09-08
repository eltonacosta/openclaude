import { PassThrough } from 'stream'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'pm-debug-'))
process.env.OPENAI_API_KEY = ''
delete process.env.AIMLAPI_API_KEY

function stripAnsi(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\][^\u0007]*\u0007/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function extractLastFrame(output: string): string {
  const lines = output.split('\n')
  const frameStart = lines.reduce<number>((lastIndex, line, index) => {
    if (line.trim() === '') return index
    return lastIndex
  }, 0)
  return lines.slice(frameStart).join('\n').trim()
}

const { mock } = await import('bun:test')

mock.module('../utils/providerProfiles.js', () => ({
  addProviderProfile: () => null,
  applyActiveProviderProfileFromConfig: () => {},
  deleteProviderProfile: () => ({ removed: false, activeProfileId: null }),
  getActiveProviderProfile: () => null,
  getProviderProfiles: () => [],
  getProviderPresetDefaults: (preset: string) => {
    if (preset === 'custom') {
      return {
        provider: 'custom',
        name: 'Custom OpenAI-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'custom-model',
        apiKey: '',
        requiresApiKey: true,
      }
    }
    return {
      provider: 'openai',
      name: 'Test Preset',
      baseUrl: 'http://localhost:9999/v1',
      model: 'test-model',
      apiKey: '',
      requiresApiKey: true,
    }
  },
  getProviderPresetList: () => ['custom'],
  updateProviderProfile: () => null,
  setActiveProviderProfile: () => null,
}))

mock.module('../integrations/providerUiMetadata.js', () => ({
  getProviderUiMetadata: (id: string) => ({ badge: undefined }),
  getProviderBadge: () => undefined,
}))

mock.module('../services/aimlapiPortal.js', () => ({
  createAimlapiEmailOnboarding: async () => ({
    beginAimlapiEmailOnboarding: async () => ({ status: 'code-sent', onboardingId: 'onb-1', email: 'a@b.c' }),
    completeAimlapiEmailSignIn: async () => ({ status: 'signed-in', apiKey: 'minted', keyId: 'k1' }),
    getAimlapiPortalBalance: async () => ({ usd: 100 }),
  }),
  resolveAimlapiEndpoints: () => ({
    inferenceBaseUrl: 'https://api.aimlapi.com/v1',
    catalogBaseUrl: 'https://api.aimlapi.com/v1',
  }),
}))

const nonce = `${Date.now()}-${Math.random()}`
const { ProviderManager } = await import(`../components/ProviderManager.js?ts=${nonce}`)
const { createRoot } = await import('../ink/root.js')
const React = await import('react')

const stdout = new PassThrough() as unknown as NodeJS.WriteStream
const stdin = new PassThrough()
let raw = ''
stdout.on('data', (chunk: Buffer) => {
  raw += chunk.toString()
})

const root = await createRoot({
  stdout,
  stdin: stdin as unknown as NodeJS.ReadStream,
  patchConsole: false,
})
root.render(
  React.createElement(ProviderManager, {
    mode: 'manage',
    onDone: () => {},
  }),
)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
await sleep(1200)
console.log('=== INITIAL FRAME ===')
console.log(extractLastFrame(stripAnsi(raw)))

stdin.write('\r')
await sleep(1200)
console.log('=== AFTER ENTER (preset list) ===')
console.log(extractLastFrame(stripAnsi(raw)))

// navigate to Custom (last)
for (let i = 0; i < 40; i++) stdin.write('j')
await sleep(600)
stdin.write('\r')
await sleep(1200)
console.log('=== AFTER SELECTING CUSTOM ===')
console.log(extractLastFrame(stripAnsi(raw)))

stdin.write('\r') // name
await sleep(600)
stdin.write('\r') // base URL
await sleep(600)
stdin.write('\r') // model
await sleep(1200)
console.log('=== AFTER MODEL (should be API mode) ===')
console.log(extractLastFrame(stripAnsi(raw)))

root.unmount()
stdin.end()
stdout.end()
await sleep(50)
process.exit(0)
