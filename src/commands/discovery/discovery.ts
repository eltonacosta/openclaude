import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { loadOrbitConfig } from '../../utils/orbitConfig.js'
import { runDiscovery } from '../../services/discovery/orbitDiscovery.js'
import { ModelRegistry } from '../../utils/model/modelRegistry.js'

export const call: LocalCommandCall = async (
  _args,
  _context,
): Promise<LocalCommandResult> => {
  const config = loadOrbitConfig()
  const apiUrl = config?.api_url || process.env.OPENAI_BASE_URL
  const apiKey = config?.api_key || process.env.OPENAI_API_KEY

  if (!apiUrl || !apiKey) {
    return {
      type: 'text',
      value:
        'No Orbit Router configuration found.\n' +
        'Please run `/login <API_URL> <API_KEY>` first to authenticate.',
    }
  }

  try {
    const models = await runDiscovery(apiUrl, apiKey)
    const updateResult = (models as any).updateResult ?? ModelRegistry.getLastUpdateResult()
    const changedCount = updateResult?.totalChanged ?? models.length

    return {
      type: 'text',
      value:
        `Descoberta concluída a partir de ${apiUrl}.\n` +
        `${changedCount} modelos atualizados ou adicionados.\n` +
        `Total de modelos disponíveis (/v1/models): ${models.length}.\n\n` +
        `Use /models para pesquisar e selecionar modelos.`,
    }
  } catch (error) {
    return {
      type: 'text',
      value: `Discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
