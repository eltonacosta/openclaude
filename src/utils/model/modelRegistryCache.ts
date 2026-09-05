import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import type { OrbitModel } from './modelRegistry.js'

/**
 * Disk-persisted cache for models discovered from the Orbit Router.
 *
 * The in-memory ModelRegistry resets on every process start. This module
 * keeps the last successful discovery around so the registry can be hydrated
 * at boot without requiring a manual `/discovery`.
 *
 * The cache is global (shared across projects), matching the scope of
 * `~/.orbitcode/config.json` where Orbit Router credentials live.
 */

export interface OrbitModelCacheFile {
  version: 1
  savedAt: string
  apiUrl: string
  models: OrbitModel[]
}

const CACHE_FILE_VERSION = 1 as const

let modelRegistryCachePathOverride: string | undefined

/**
 * Test-only escape hatch — redirects the cache file path so unit tests never
 * touch the real `~/.orbitcode` directory.
 */
export function setModelRegistryCachePathOverrideForTesting(
  path: string | undefined,
): void {
  modelRegistryCachePathOverride = path
}

/**
 * Resolves the global cache file path.
 * Defaults to `~/.orbitcode/models-cache.json` (same home dir as the Orbit
 * Router `config.json`).
 */
export function getModelRegistryCachePath(): string {
  if (modelRegistryCachePathOverride !== undefined) {
    return modelRegistryCachePathOverride
  }
  return join(getClaudeConfigHomeDir(), 'models-cache.json')
}

/**
 * Guards a parsed cache payload: only accepts objects carrying the expected
 * shape and a non-empty model list. Anything else (corrupt JSON, older
 * format, empty list) is treated as "no usable cache".
 */
function isValidCacheFile(data: unknown): data is OrbitModelCacheFile {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Partial<OrbitModelCacheFile>
  if (candidate.version !== CACHE_FILE_VERSION) return false
  if (typeof candidate.savedAt !== 'string') return false
  if (typeof candidate.apiUrl !== 'string' || !candidate.apiUrl) return false
  if (!Array.isArray(candidate.models)) return false
  if (candidate.models.length === 0) return false
  return candidate.models.every(
    m =>
      m !== null &&
      typeof m === 'object' &&
      typeof (m as OrbitModel).id === 'string' &&
      typeof (m as OrbitModel).displayName === 'string' &&
      typeof (m as OrbitModel).context_window === 'number' &&
      typeof (m as OrbitModel).supports_efforts === 'boolean' &&
      typeof (m as OrbitModel).supports_tools === 'boolean',
  )
}

/**
 * Reads the persisted model cache.
 *
 * Returns `null` when no cache exists, the file is corrupt, an older format is
 * found, or the model list fails validation — callers treat null as "nothing
 * cached" and never crash on bad data.
 */
export function loadModelsCache(): OrbitModelCacheFile | null {
  const cachePath = getModelRegistryCachePath()
  if (!existsSync(cachePath)) {
    return null
  }

  try {
    const raw = readFileSync(cachePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isValidCacheFile(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Persists the current model list to the global cache file.
 *
 * Refuses to write an empty model list on top of an existing cache so a
 * transient discovery failure (router returning zero models) cannot wipe the
 * last known-good catalog. Creates the parent directory if needed.
 */
export function saveModelsCache(
  models: OrbitModel[],
  apiUrl: string,
): void {
  if (models.length === 0) {
    return
  }

  const cachePath = getModelRegistryCachePath()
  const payload: OrbitModelCacheFile = {
    version: CACHE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    apiUrl,
    models,
  }

  try {
    const targetDir = dirname(cachePath)
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }
    writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    // Cache writes must never break discovery or boot.
  }
}

/**
 * Removes the persisted model cache (e.g. on registry clear).
 * No-op when the file does not exist.
 */
export function clearModelsCache(): void {
  const cachePath = getModelRegistryCachePath()
  try {
    if (existsSync(cachePath)) {
      rmSync(cachePath, { force: true })
    }
  } catch {
    // Best-effort cleanup.
  }
}