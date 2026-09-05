import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export interface OrbitRouterConfig {
  api_url: string
  router_url: string
  api_key: string
}

export interface ConfigFileStructure {
  orbit_router?: {
    api_url?: string
    router_url?: string
    api_key?: string
  }
  [key: string]: unknown
}

/**
 * Normalizes a URL by trimming whitespace and removing trailing slashes.
 */
export function normalizeRouterUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

let orbitConfigPathOverride: string | undefined

export function setOrbitConfigPathOverrideForTesting(
  path: string | undefined,
): void {
  orbitConfigPathOverride = path
}

/**
 * Resolves the configuration file path.
 * Prefers `./config.json` in the current working directory if it exists,
 * otherwise defaults to `~/.orbitcode/config.json`.
 */
export function getOrbitConfigPath(): string {
  if (orbitConfigPathOverride !== undefined) {
    return orbitConfigPathOverride
  }
  const localPath = join(process.cwd(), 'config.json')
  if (existsSync(localPath)) {
    return localPath
  }
  return join(getClaudeConfigHomeDir(), 'config.json')
}

/**
 * Reads and returns the Orbit Router config if present in the config file.
 */
export function loadOrbitConfig(customPath?: string): OrbitRouterConfig | null {
  const configPath = customPath ?? getOrbitConfigPath()
  if (!existsSync(configPath)) {
    return null
  }

  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as ConfigFileStructure

    const routerBlock = parsed.orbit_router
    if (!routerBlock) {
      return null
    }

    const apiUrl = routerBlock.api_url || routerBlock.router_url
    const apiKey = routerBlock.api_key

    if (!apiUrl || !apiKey) {
      return null
    }

    const cleanUrl = normalizeRouterUrl(apiUrl)
    return {
      api_url: cleanUrl,
      router_url: cleanUrl,
      api_key: apiKey.trim(),
    }
  } catch {
    return null
  }
}

/**
 * Applies Orbit Router configuration directly to process.env at runtime.
 */
export function applyOrbitConfigToEnv(config: OrbitRouterConfig): void {
  process.env.OPENAI_BASE_URL = config.api_url
  process.env.OPENAI_API_KEY = config.api_key
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
}

/**
 * Saves Orbit Router credentials to the configuration file and updates process.env.
 * Creates the configuration file and its parent directories if they do not exist.
 */
export function saveOrbitConfig(
  routerUrl: string,
  apiKey: string,
  customPath?: string,
): OrbitRouterConfig {
  const cleanUrl = normalizeRouterUrl(routerUrl)
  const cleanKey = apiKey.trim()
  const configPath = customPath ?? getOrbitConfigPath()

  let existingData: ConfigFileStructure = {}
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8')
      existingData = JSON.parse(raw) as ConfigFileStructure
    } catch {
      existingData = {}
    }
  }

  const orbitConfig: OrbitRouterConfig = {
    api_url: cleanUrl,
    router_url: cleanUrl,
    api_key: cleanKey,
  }

  const updatedData: ConfigFileStructure = {
    ...existingData,
    orbit_router: {
      ...(existingData.orbit_router ?? {}),
      api_url: cleanUrl,
      router_url: cleanUrl,
      api_key: cleanKey,
    },
  }

  const targetDir = dirname(configPath)
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  writeFileSync(configPath, `${JSON.stringify(updatedData, null, 2)}\n`, 'utf8')

  applyOrbitConfigToEnv(orbitConfig)
  return orbitConfig
}
