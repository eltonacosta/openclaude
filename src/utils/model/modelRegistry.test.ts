import { describe, expect, it, beforeEach } from 'bun:test'
import { ModelRegistry, type OrbitModel } from './modelRegistry.js'

describe('ModelRegistry', () => {
  beforeEach(() => {
    ModelRegistry.clear()
  })

  it('starts empty', () => {
    expect(ModelRegistry.hasModels()).toBe(false)
    expect(ModelRegistry.getModels()).toEqual([])
  })

  it('updates and retrieves models in memory', () => {
    const testModels: OrbitModel[] = [
      {
        id: 'oc/big-pickle',
        displayName: 'big-pickle',
        context_window: 128000,
        supports_efforts: true,
        supports_tools: true,
      },
      {
        id: 'oc/small-pickle',
        displayName: 'small-pickle',
        context_window: 32768,
        supports_efforts: false,
        supports_tools: true,
      },
    ]

    ModelRegistry.updateModels(testModels)

    expect(ModelRegistry.hasModels()).toBe(true)
    expect(ModelRegistry.getModels()).toHaveLength(2)
    expect(ModelRegistry.getModels()[0]?.id).toBe('oc/big-pickle')
  })

  it('finds models by full ID, displayName, or base name', () => {
    ModelRegistry.updateModels([
      {
        id: 'oc/big-pickle',
        displayName: 'big-pickle',
        context_window: 128000,
        supports_efforts: true,
        supports_tools: true,
      },
    ])

    // Match full ID
    expect(ModelRegistry.getModel('oc/big-pickle')?.id).toBe('oc/big-pickle')
    expect(ModelRegistry.getModel('OC/BIG-PICKLE')?.id).toBe('oc/big-pickle')

    // Match displayName / base name
    expect(ModelRegistry.getModel('big-pickle')?.id).toBe('oc/big-pickle')
    expect(ModelRegistry.getModel('BIG-PICKLE')?.id).toBe('oc/big-pickle')

    // Not found
    expect(ModelRegistry.getModel('unknown')).toBeUndefined()
  })

  it('clears models correctly', () => {
    ModelRegistry.updateModels([
      {
        id: 'oc/pickle',
        displayName: 'pickle',
        context_window: 4096,
        supports_efforts: false,
        supports_tools: true,
      },
    ])

    expect(ModelRegistry.hasModels()).toBe(true)
    ModelRegistry.clear()
    expect(ModelRegistry.hasModels()).toBe(false)
    expect(ModelRegistry.getModels()).toHaveLength(0)
    expect(ModelRegistry.getLastUpdateResult()).toBeNull()
  })

  it('calculates added and updated counts correctly on successive updates', () => {
    // Initial batch: 2 added
    const res1 = ModelRegistry.updateModels([
      {
        id: 'oc/model-a',
        displayName: 'model-a',
        context_window: 4096,
        supports_efforts: false,
        supports_tools: true,
      },
      {
        id: 'oc/model-b',
        displayName: 'model-b',
        context_window: 8192,
        supports_efforts: false,
        supports_tools: true,
      },
    ])

    expect(res1.addedCount).toBe(2)
    expect(res1.updatedCount).toBe(0)
    expect(res1.totalChanged).toBe(2)

    // Second batch: identical, 0 changed
    const res2 = ModelRegistry.updateModels([
      {
        id: 'oc/model-a',
        displayName: 'model-a',
        context_window: 4096,
        supports_efforts: false,
        supports_tools: true,
      },
      {
        id: 'oc/model-b',
        displayName: 'model-b',
        context_window: 8192,
        supports_efforts: false,
        supports_tools: true,
      },
    ])

    expect(res2.addedCount).toBe(0)
    expect(res2.updatedCount).toBe(0)
    expect(res2.totalChanged).toBe(0)

    // Third batch: 1 updated (context_window changed), 1 added, 1 removed
    const res3 = ModelRegistry.updateModels([
      {
        id: 'oc/model-a',
        displayName: 'model-a',
        context_window: 16384, // changed!
        supports_efforts: false,
        supports_tools: true,
      },
      {
        id: 'oc/model-c', // added!
        displayName: 'model-c',
        context_window: 32768,
        supports_efforts: true,
        supports_tools: true,
      },
    ])

    expect(res3.addedCount).toBe(1)
    expect(res3.updatedCount).toBe(1)
    expect(res3.totalChanged).toBe(2)
  })
})
