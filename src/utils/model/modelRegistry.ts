export interface OrbitModel {
  /** Full model ID used for API requests, e.g. "oc/big-pickle" */
  id: string
  /** Base display name parsed from the ID, e.g. "big-pickle" */
  displayName: string
  /** Context window limit in tokens */
  context_window: number
  /** Whether the model supports reasoning/efforts parameter */
  supports_efforts: boolean
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
 */
export class ModelRegistry {
  private static models: OrbitModel[] = []
  private static lastUpdateResult: UpdateModelsResult | null = null

  /**
   * Replaces the current in-memory model catalog with a new list,
   * calculating the number of newly added or updated models.
   */
  static updateModels(newModels: OrbitModel[]): UpdateModelsResult {
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
          prev.description !== m.description
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
   * Clears the in-memory registry.
   */
  static clear(): void {
    this.models = []
    this.lastUpdateResult = null
  }
}
