import { feature } from 'bun:bundle'
import * as React from 'react'

// Use the cost-tracker wrapper (not the raw bootstrap reset) so the routing
// tally is cleared alongside cost counters on an account switch.
import { resetCostState } from '../../cost-tracker.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from '../../bridge/trustedDevice.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import {
  ConsoleOAuthFlow,
  type ConsoleOAuthFlowResult,
} from '../../components/ConsoleOAuthFlow.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Text } from '../../ink.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../../services/policyLimits/index.js'
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { resetUserCache } from '../../utils/user.js'

import { saveOrbitConfig } from '../../utils/orbitConfig.js'
import { runDiscovery } from '../../services/discovery/orbitDiscovery.js'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'

type LoginCompletion =
  | ConsoleOAuthFlowResult
  | {
      type: 'cancel'
    }

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
        const savedConfig = saveOrbitConfig(apiUrl!, apiKey!)
        const models = await runDiscovery(savedConfig.api_url, savedConfig.api_key)

        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        resetCostState()
        resetUserCache()

        if (models.length > 0) {
          const firstModel = models[0]!
          context.setAppState(prev => ({
            ...prev,
            mainLoopModel: firstModel.id,
            authVersion: prev.authVersion + 1,
          }))
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

  return (
    <Login
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Login interrupted')
          return
        }

        if (result.type === 'provider-setup') {
          onDone(result.message, { display: 'system' })
          return
        }

        context.onChangeAPIKey()
        // Signature-bearing blocks (thinking, connector_text) are bound to the
        // API key. Strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks)

        // Post-login refresh logic. Keep in sync with onboarding in
        // src/interactiveHelpers.tsx.
        resetCostState()
        void refreshRemoteManagedSettings()
        void refreshPolicyLimits()
        resetUserCache()
        refreshGrowthBookAfterAuthChange()

        // Clear any stale trusted device token from a previous account before
        // re-enrolling to avoid sending the old token while enrollment is
        // in flight.
        clearTrustedDeviceToken()
        void enrollTrustedDevice()

        resetBypassPermissionsCheck()
        const appState = context.getAppState()
        void checkAndDisableBypassPermissionsIfNeeded(
          appState.toolPermissionContext,
          context.setAppState,
        )

        if (feature('TRANSCRIPT_CLASSIFIER')) {
          resetAutoModeGateCheck()
          void checkAndDisableAutoModeIfNeeded(
            appState.toolPermissionContext,
            context.setAppState,
            appState.fastMode,
          )
        }

        context.setAppState(prev => ({
          ...prev,
          authVersion: prev.authVersion + 1,
        }))

        onDone('Login successful')
      }}
    />
  )
}

export function Login(props: {
  onDone: (result: LoginCompletion, mainLoopModel: string) => void
  startingMessage?: string
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel()

  return (
    <Dialog
      title="Login"
      onCancel={() => props.onDone({ type: 'cancel' }, mainLoopModel)}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="cancel"
          />
        )
      }
    >
      <ConsoleOAuthFlow
        onDone={result =>
          props.onDone(result ?? { type: 'cancel' }, mainLoopModel)
        }
        startingMessage={props.startingMessage}
      />
    </Dialog>
  )
}
