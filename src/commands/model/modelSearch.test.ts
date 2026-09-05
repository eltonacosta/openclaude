import { describe, expect, it, beforeEach } from 'bun:test'
import modelCommand from './index.js'
import { call } from './model.js'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'
import { setModelRegistryCachePathOverrideForTesting } from '../../utils/model/modelRegistryCache.js'
import type { LocalJSXCommandContext } from '../../commands.js'

describe('model command and search', () => {
  beforeEach(() => {
    setModelRegistryCachePathOverrideForTesting('/nonexistent/cache/path.json')
    ModelRegistry.clear()
  })

  it('declares /models as an alias of /model', () => {
    expect(modelCommand.name).toBe('model')
    expect(modelCommand.aliases).toContain('models')
  })

  it('sets model directly when an exact registered model is specified', async () => {
    ModelRegistry.updateModels([
      {
        id: 'oc/big-pickle',
        displayName: 'big-pickle',
        context_window: 128000,
        supports_efforts: true,
        supports_tools: true,
      },
    ])

    let doneMessage = ''
    const onDone = (msg?: string) => {
      doneMessage = msg || ''
    }

    const mockContext = {
      setAppState: () => {},
    } as unknown as LocalJSXCommandContext

    const result = (await call(onDone, mockContext, 'oc/big-pickle')) as React.ReactElement<any>
    expect(result).not.toBeNull()
    expect(result?.type).toBeDefined()
    expect(result?.props.args).toBe('oc/big-pickle')
  })

  it('opens interactive picker with initialQuery when a search query is provided', async () => {
    ModelRegistry.updateModels([
      {
        id: 'oc/deepseek-r1',
        displayName: 'deepseek-r1',
        context_window: 131072,
        supports_efforts: true,
        supports_tools: true,
      },
      {
        id: 'oc/cucumber',
        displayName: 'cucumber',
        context_window: 32768,
        supports_efforts: false,
        supports_tools: true,
      },
    ])

    let doneMessage = ''
    const onDone = (msg?: string) => {
      doneMessage = msg || ''
    }

    const mockContext = {
      setAppState: () => {},
    } as unknown as LocalJSXCommandContext

    // Pass a search query that is not an exact model ID
    const jsx = (await call(onDone, mockContext, 'deepseek')) as React.ReactElement<any>

    // It returns the interactive ModelPickerWrapper JSX component with search query!
    expect(jsx).not.toBeNull()
    expect(jsx?.type).toBeDefined()
    expect(jsx?.props.initialQuery).toBe('deepseek')
  })
})
