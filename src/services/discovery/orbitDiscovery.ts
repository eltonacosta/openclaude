import { logForDebugging } from '../../utils/debug.js'
import { ModelRegistry, type OrbitModel } from '../../utils/model/modelRegistry.js'

export const DEFAULT_MODELS_DEV_URL = 'https://models.dev/models.json'
export const FALLBACK_MODELS_DEV_API_URL = 'https://models.dev/api.json'

export interface RouterRawModel {
  id: string
  context_window?: number
  context_length?: number
  max_context_length?: number
  max_model_len?: number
  max_input_tokens?: number
  supports_efforts?: boolean
  supports_tools?: boolean
  description?: string
  [key: string]: unknown
}

export interface DevModelInfo {
  supports_reasoning?: boolean
  name?: string
}

export type FetchLike = (
  input: RequestInfo | URL | string,
  init?: RequestInit,
) => Promise<Response>

/**
 * Builds candidate model endpoint URLs for the given Orbit Router URL.
 */
export function getRouterModelsUrls(apiUrl: string): string[] {
  const clean = apiUrl.trim().replace(/\/+$/, '')
  if (clean.endsWith('/v1')) {
    return [`${clean}/models`]
  }
  return [`${clean}/v1/models`, `${clean}/models`]
}

/**
 * Fetches the raw model list from Orbit Router using the API key.
 * Only models returned by this endpoint are considered available for use.
 */
export async function fetchRouterModels(
  apiUrl: string,
  apiKey: string,
  fetchFn: FetchLike = fetch,
): Promise<RouterRawModel[]> {
  const urls = getRouterModelsUrls(apiUrl)
  let lastError: unknown = null

  for (const url of urls) {
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} from ${url}`)
        continue
      }

      const payload = (await response.json()) as {
        data?: unknown
      }

      const rawList = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : []

      const models: RouterRawModel[] = []
      for (const item of rawList) {
        if (!item) continue
        if (typeof item === 'string') {
          models.push({ id: item })
        } else if (typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
          models.push(item as RouterRawModel)
        }
      }

      return models
    } catch (err) {
      lastError = err
      logForDebugging(`[OrbitDiscovery] Failed to fetch models from ${url}: ${String(err)}`)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch models from Orbit Router at ${apiUrl}`)
}

/**
 * Indexes the models.dev catalog for fast case-insensitive lookup by parsed base name and full ID.
 */
export function indexDevModelsCatalog(catalogData: Record<string, unknown>): Record<string, DevModelInfo> {
  const index: Record<string, DevModelInfo> = {}

  for (const [key, val] of Object.entries(catalogData || {})) {
    if (!val || typeof val !== 'object') continue

    // Handle models.dev/api.json structure (provider.models dictionary)
    if ('models' in val && val.models && typeof val.models === 'object') {
      const providerModels = val.models as Record<string, unknown>
      for (const [modelKey, modelVal] of Object.entries(providerModels)) {
        if (!modelVal || typeof modelVal !== 'object') continue
        const m = modelVal as Record<string, unknown>
        const info: DevModelInfo = {
          supports_reasoning:
            (m.reasoning as boolean | undefined) ??
            (m.supports_reasoning as boolean | undefined),
          name: m.name as string | undefined,
        }

        registerModelInIndex(index, modelKey, m.id as string | undefined, info)
      }
    } else {
      // Handle models.dev/models.json structure (direct dictionary of models)
      const m = val as Record<string, unknown>
      const info: DevModelInfo = {
        supports_reasoning:
          (m.reasoning as boolean | undefined) ??
          (m.supports_reasoning as boolean | undefined),
        name: m.name as string | undefined,
      }

      registerModelInIndex(index, key, m.id as string | undefined, info)
    }
  }

  return index
}

function registerModelInIndex(
  index: Record<string, DevModelInfo>,
  primaryKey: string,
  modelId: string | undefined,
  info: DevModelInfo,
): void {
  const keysToRegister = new Set<string>()
  const registerName = (name: string | undefined): void => {
    if (!name) return
    const normalized = name.trim().toLowerCase()
    if (!normalized) return

    keysToRegister.add(normalized)
    const baseName = normalized.split('/').pop()
    if (baseName) keysToRegister.add(baseName)

    // models.dev names are sometimes human-readable while router IDs use
    // kebab-case (for example, "Gemini 3.8 Flash" -> "gemini-3.8-flash").
    const slug = normalized
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (slug) keysToRegister.add(slug)
  }

  // Register every catalog identifier and the human-readable model name.
  // Router providers may use a different prefix than models.dev, so the
  // provider-free aliases are needed for variant matching.
  registerName(primaryKey)
  registerName(modelId)
  registerName(info.name)

  for (const k of keysToRegister) {
    if (!index[k]) {
      index[k] = info
    }
  }
}

function findDevModelInfo(
  modelId: string,
  catalog: Record<string, DevModelInfo>,
): DevModelInfo | undefined {
  const normalizedModelId = modelId.trim().toLowerCase()
  const parsedName = normalizedModelId.split('/').pop() || normalizedModelId

  const exactMatch = catalog[normalizedModelId] || catalog[parsedName]
  if (exactMatch) {
    return exactMatch
  }

  // Router IDs often add a provider prefix and a serving variant, such as
  // "ag/gemini-3.8-flash-high" for the models.dev entry
  // "google/gemini-3.8-flash". Compare both the complete router ID and its
  // provider-free name, then prefer the longest catalog alias.
  return Object.entries(catalog)
    .filter(([catalogName]) =>
      normalizedModelId.includes(catalogName) || parsedName.includes(catalogName),
    )
    .sort(([left], [right]) => right.length - left.length)
    .at(0)?.[1]
}

/**
 * Downloads and indexes models.dev reasoning metadata.
 * Uses https://models.dev/models.json primarily (~297KB), falling back to api.json if needed.
 */
export async function fetchDevModelsCatalog(
  fetchFn: FetchLike = fetch,
): Promise<Record<string, DevModelInfo>> {
  try {
    const response = await fetchFn(DEFAULT_MODELS_DEV_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>
      return indexDevModelsCatalog(data)
    }
  } catch (err) {
    logForDebugging(`[OrbitDiscovery] Primary models.dev/models.json fetch failed: ${String(err)}`)
  }

  // Fallback to api.json
  try {
    const response = await fetchFn(FALLBACK_MODELS_DEV_API_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>
      return indexDevModelsCatalog(data)
    }
  } catch (err) {
    logForDebugging(`[OrbitDiscovery] Fallback models.dev/api.json fetch failed: ${String(err)}`)
  }

  return {}
}

/**
 * Resolves the router-advertised context window from the raw gateway payload.
 * Gateways use different keys for the same value, so every known alias is
 * checked in OpenAI-compatibility order. Falls back to 4096 when the gateway
 * omits it or sends a non-positive/non-finite value — persisting a 0/null
 * would shrink the registry window to zero and make auto-compact fire on
 * every turn.
 */
function firstPositiveWindowValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

function resolveRouterContextWindow(model: RouterRawModel): number {
  return (
    firstPositiveWindowValue(
      model.context_length,
      model.max_context_length,
      model.context_window,
      model.max_model_len,
      model.max_input_tokens,
    ) ?? 4096
  )
}

/**
 * Executes the full discovery and enrichment pipeline:
 * 1. Fetches models and runtime metadata from Orbit Router (`/v1/models`).
 * 2. Fetches reasoning support from models.dev.
 * 3. Maps exclusively the router models, enriching only effort support.
 * 4. Updates ModelRegistry in memory.
 */
export async function runDiscovery(
  apiUrl: string,
  apiKey: string,
  options?: {
    fetchFn?: FetchLike
  },
): Promise<OrbitModel[]> {
  const fetchFn = options?.fetchFn ?? fetch

  // 1. Fetch available models from Orbit Router
  const routerModels = await fetchRouterModels(apiUrl, apiKey, fetchFn)

  // 2. Fetch reasoning metadata
  let devModelsCatalog: Record<string, DevModelInfo> = {}
  try {
    devModelsCatalog = await fetchDevModelsCatalog(fetchFn)
  } catch {
    devModelsCatalog = {}
  }

  // 3. Process exclusively the models from Orbit Router
  const updatedModelsList: OrbitModel[] = routerModels.map(model => {
    const fullId = model.id
    const parsedName = fullId.split('/').pop() || fullId

    // Match exact IDs first, then identify router variants by the longest
    // models.dev name. Only effort support is imported from models.dev.
    const matchedDevModel = findDevModelInfo(fullId, devModelsCatalog)

    return {
      id: fullId, // Used in API inference requests
      displayName: parsedName,
      context_window: resolveRouterContextWindow(model),
      supports_efforts:
        matchedDevModel?.supports_reasoning ?? model.supports_efforts ?? false,
      supports_tools: model.supports_tools ?? true,
      description: model.description,
      raw: model,
    }
  })

  // 4. Update in-memory registry without restarting the application.
  //    Passing apiUrl also persists the catalog to the global on-disk cache
  //    so the models survive process restarts.
  const updateResult = ModelRegistry.updateModels(updatedModelsList, apiUrl)

  return Object.assign(updatedModelsList, { updateResult })
}
