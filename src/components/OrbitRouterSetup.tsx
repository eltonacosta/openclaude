import * as React from 'react'
import { Box, Text, useInput } from '../ink.js'
import { runDiscovery } from '../services/discovery/orbitDiscovery.js'
import { loadOrbitConfig, saveOrbitConfig } from '../utils/orbitConfig.js'
import { Dialog } from './design-system/Dialog.js'
import TextInput from './TextInput.js'

export type OrbitSetupResult =
  | { type: 'done'; apiUrl: string; modelCount: number }
  | { type: 'skip' }

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function UrlStep(props: { onSubmit: (url: string) => void }): React.ReactElement {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text bold color="brand">
          Welcome to Orbit Code
        </Text>
      </Box>
      <Text dimColor>No router configured yet. Enter your Orbit-compatible API URL:</Text>
      <Box>
        <Text>API URL › </Text>
        <TextInput
          value={value}
          onChange={setValue}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          columns={60}
          onSubmit={submitted => {
            const url = normalizeUrl(submitted)
            if (url) props.onSubmit(url)
          }}
        />
      </Box>
      <Text dimColor>Example: https://ai.servhub.xyz/v1 (Esc to skip)</Text>
    </Box>
  )
}

function TextInputRetry(props: { onRetry: () => void }): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) props.onRetry()
  })
  return <Box />
}

function TokenStep(props: {
  apiUrl: string
  onSubmit: (token: string) => void
}): React.ReactElement {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        Router: <Text>{props.apiUrl}</Text>
      </Text>
      <Text dimColor>Now enter your API token:</Text>
      <Box>
        <Text>API token › </Text>
        <TextInput
          value={value}
          onChange={setValue}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          columns={60}
          onSubmit={submitted => {
            const token = submitted.trim()
            if (token) props.onSubmit(token)
          }}
          mask="*"
        />
      </Box>
    </Box>
  )
}

/**
 * First-boot Orbit Router setup: asks for the API URL, then the API token
 * (masked), saves both, and runs discovery — the same
 * saveOrbitConfig + runDiscovery pair as `/login <API_URL> <API_KEY>`.
 * Shown when no Orbit config or functional credentials are stored.
 */
export function OrbitRouterSetup(props: {
  onDone: (result: OrbitSetupResult) => void
}): React.ReactElement {
  const [step, setStep] = React.useState<'url' | 'token' | 'working' | 'error'>('url')
  const [apiUrl, setApiUrl] = React.useState('')
  const [error, setError] = React.useState('')

  const submitToken = (token: string): void => {
    setStep('working')
    setError('')
    void (async () => {
      try {
        // Validate against the live router BEFORE persisting: a failed
        // discovery must not leave an invalid config behind, or the next
        // boot would see "credentials" and skip setup with a dead endpoint.
        const models = await runDiscovery(apiUrl, token)
        const saved = saveOrbitConfig(apiUrl, token)
        props.onDone({ type: 'done', apiUrl: saved.api_url, modelCount: models.length })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStep('error')
      }
    })()
  }

  if (step === 'url') {
    return (
      <Dialog title="Router setup" onCancel={() => props.onDone({ type: 'skip' })}>
        <UrlStep
          onSubmit={url => {
            setApiUrl(url)
            setStep('token')
          }}
        />
      </Dialog>
    )
  }

  if (step === 'token') {
    return (
      <Dialog title="Router setup" onCancel={() => props.onDone({ type: 'skip' })}>
        <TokenStep apiUrl={apiUrl} onSubmit={submitToken} />
      </Dialog>
    )
  }

  if (step === 'working') {
    return (
      <Box>
        <Text dimColor>Connecting to {apiUrl} and discovering models…</Text>
      </Box>
    )
  }

  return (
    <Dialog title="Router setup" onCancel={() => props.onDone({ type: 'skip' })}>
      <Box flexDirection="column" gap={1}>
        <Text color="red">Could not reach the router: {error}</Text>
        <Box>
          <Text dimColor>Press Enter to try again, or Esc to exit setup.</Text>
        </Box>
        <TextInputRetry onRetry={() => setStep('url')} />
      </Box>
    </Dialog>
  )
}

/**
 * True when Orbit Router credentials are stored in the Orbit config file
 * (~/.orbitcode/config.json). This is the single source of truth for the
 * first-boot gate: env vars and legacy provider profiles are deliberately
 * ignored because settings-env replay populates process.env before the gate
 * runs, which would otherwise skip setup with stale credentials.
 */
export function hasOrbitCredentials(): boolean {
  return loadOrbitConfig() !== null
}
