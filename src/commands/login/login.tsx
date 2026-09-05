import * as React from 'react'

// Use the cost-tracker wrapper (not the raw bootstrap reset) so the routing
// tally is cleared alongside cost counters on an account switch.
import { resetCostState } from '../../cost-tracker.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import { resetUserCache } from '../../utils/user.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

import { saveOrbitConfig } from '../../utils/orbitConfig.js'
import { runDiscovery } from '../../services/discovery/orbitDiscovery.js'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const trimmedArgs = args?.trim()
  if (trimmedArgs) {
    const parts = trimmedArgs.split(/\s+/)
    if (parts.length >= 2) {
      const [apiUrl, apiKey] = parts
      try {
        // Validate against the live router BEFORE persisting so a failed
        // login never leaves an invalid config behind.
        const models = await runDiscovery(apiUrl!, apiKey!)
        const savedConfig = saveOrbitConfig(apiUrl!, apiKey!)

        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        resetCostState()
        resetUserCache()

        if (models.length > 0) {
          context.setAppState(prev => {
            const previousModel = prev.mainLoopModel
            const selectedModel =
              previousModel && models.some(model => model.id === previousModel)
                ? previousModel
                : models[0]!.id

            updateSettingsForSource('userSettings', { model: selectedModel })

            return {
              ...prev,
              mainLoopModel: selectedModel,
              authVersion: prev.authVersion + 1,
            }
          })
        } else {
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }))
        }

        const updateResult = (models as any).updateResult ?? ModelRegistry.getLastUpdateResult()
        const changedCount = updateResult?.totalChanged ?? models.length
        const changeSummary = `${changedCount} modelos atualizados ou adicionados`

        onDone(
          `Orbit Router login successful!\nRouter URL: ${savedConfig.api_url}\n${changeSummary}.`,
          { display: 'system' },
        )
        return null
      } catch (err) {
        onDone(
          `Orbit Router login failed: ${err instanceof Error ? err.message : String(err)}`,
          { display: 'system' },
        )
        return null
      }
    } else {
      onDone(
        'Usage: /login <API_URL> <API_KEY>\nExample: /login https://ai.servhub.xyz/v1 sk-d3bb44760a989aee-qdimps-0d5e8888',
        { display: 'system' },
      )
      return null
    }
  }

  // Bare /login without args opens the interactive Orbit Router setup
  // (API URL → API token → discovery), the same flow as first boot.
  const { OrbitRouterSetup } = await import('../../components/OrbitRouterSetup.js')
  return (
    <OrbitRouterSetup
      onDone={result => {
        if (result.type === 'skip') {
          onDone('Login skipped. Run /login <API_URL> <API_KEY> to configure the router.', {
            display: 'system',
          })
          return
        }
        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        resetCostState()
        resetUserCache()
        context.setAppState(prev => ({
          ...prev,
          authVersion: prev.authVersion + 1,
        }))
        onDone(
          `Orbit Router login successful!\nRouter URL: ${result.apiUrl}\n${result.modelCount} modelos atualizados ou adicionados.`,
          { display: 'system' },
        )
      }}
    />
  )
}

