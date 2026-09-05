import {
  clearModelsCache,
  loadModelsCache,
  saveModelsCache,
} from './modelRegistryCache.js'

export interface OrbitModel {
  /** Full model ID used for API requests, e.g. "oc/big-pickle" */
  id: string
  /** Base display name parsed from the ID, e.g. "big-pickle" */
  displayName: string
  /** Context window limit in tokens */
  context_window: number
  /** Whether the model supports reasoning/efforts parameter */
  supports_efforts: boolean
  /** Configurable effort levels from models.dev reasoning_options (when known) */
  effort_levels?: string[]
  /** Whether the model supports tool calls / function calling */
  supports_tools: boolean
  /** Optional human-readable description */
  description?: string
  /** Optional raw metadata from the router */
  raw?: unknown
}

export interface UpdateModelsResult {
  addedCount: number
  updatedCount: number
  totalChanged: number
  totalModels: number
}

/**
 * In-memory registry for models discovered from Orbit Router.
 * Keeps the active catalog alive in memory without restarting the application.
 *
 * The registry is hydrated from a global on-disk cache at boot
 * (loadFromCache) and persists every successful update (updateModels), so
 * models survive restarts without a manual `/discovery`.
 */
export class ModelRegistry {
  private static models: OrbitModel[] = []
  private static lastUpdateResult: UpdateModelsResult | null = null
  private static cachedApiUrl: string | undefined

  /**
   * Replaces the current in-memory model catalog with a new list,
   * calculating the number of newly added or updated models.
   * When an apiUrl is provided, the result is persisted to the global cache.
   */
  static updateModels(
    newModels: OrbitModel[],
    apiUrl?: string,
  ): UpdateModelsResult {
    const previousMap = new Map<string, OrbitModel>(
      this.models.map(m => [m.id, m]),
    )
    let addedCount = 0
    let updatedCount = 0

    for (const m of newModels) {
      const prev = previousMap.get(m.id)
      if (!prev) {
        addedCount++
      } else {
        const isChanged =
          prev.context_window !== m.context_window ||
          prev.supports_efforts !== m.supports_efforts ||
          prev.supports_tools !== m.supports_tools ||
          prev.displayName !== m.displayName ||
          prev.description !== m.description ||
          JSON.stringify(prev.effort_levels ?? []) !== JSON.stringify(m.effort_levels ?? [])
        if (isChanged) {
          updatedCount++
        }
      }
    }

    this.models = [...newModels]
    const result: UpdateModelsResult = {
      addedCount,
      updatedCount,
      totalChanged: addedCount + updatedCount,
      totalModels: this.models.length,
    }
    this.lastUpdateResult = result

    // Persist to the global cache so models survive restarts. The cache only
    // keeps non-empty lists, so a transient zero-model discovery cannot wipe
    // the last known-good catalog.
    if (apiUrl) {
      this.cachedApiUrl = apiUrl
      saveModelsCache(newModels, apiUrl)
    }

    return result
  }

  /**
   * Returns the result of the last updateModels operation.
   */
  static getLastUpdateResult(): UpdateModelsResult | null {
    return this.lastUpdateResult
  }

  /**
   * Returns all currently registered Orbit Router models.
   */
  static getModels(): OrbitModel[] {
    return [...this.models]
  }

  /**
   * Finds a registered model by its full ID (e.g. "oc/big-pickle") or
   * parsed displayName (e.g. "big-pickle").
   */
  static getModel(idOrDisplayName: string): OrbitModel | undefined {
    if (!idOrDisplayName) return undefined
    const search = idOrDisplayName.trim().toLowerCase()

    return this.models.find(model => {
      const modelId = model.id.toLowerCase()
      const displayName = model.displayName.toLowerCase()
      if (modelId === search || displayName === search) {
        return true
      }
      // Also match if search matches the parsed base name of this model
      const baseId = modelId.split('/').pop()
      return baseId === search
    })
  }

  /**
   * Returns whether there are any models currently registered.
   */
  static hasModels(): boolean {
    return this.models.length > 0
  }

  /**
   * Clears the in-memory registry and the persisted cache.
   */
  static clear(): void {
    this.models = []
    this.lastUpdateResult = null
    this.cachedApiUrl = undefined
    clearModelsCache()
  }

  /**
   * Hydrates the registry from the global on-disk cache.
   *
   * Called at boot so the last successful discovery is available without a
   * manual `/discovery`. Returns true when models were loaded, false when
   * there is no usable cache (or the cached apiUrl does not match the
   * currently configured router).
   */
  static loadFromCache(apiUrl?: string): boolean {
    const cache = loadModelsCache()
    if (!cache) {
      return false
    }

    if (apiUrl) {
      const cached = cache.apiUrl.trim().replace(/\/+$/, '')
      const current = apiUrl.trim().replace(/\/+$/, '')
      if (cached !== current) {
        return false
      }
    }

    this.models = [...cache.models]
    this.cachedApiUrl = cache.apiUrl
    this.lastUpdateResult = {
      addedCount: 0,
      updatedCount: 0,
      totalChanged: 0,
      totalModels: this.models.length,
    }
    return true
  }

  /**
   * Returns the apiUrl the current in-memory catalog was discovered from,
   * if any.
   */
  static getCachedApiUrl(): string | undefined {
    return this.cachedApiUrl
  }
}
