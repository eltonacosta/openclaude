import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'discovery',
  description: 'Discover and enrich models from the configured Orbit Router',
  supportsNonInteractive: true,
  load: () => import('./discovery.js'),
} satisfies Command
