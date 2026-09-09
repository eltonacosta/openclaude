import type { Command, LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value: MACRO.BUILD_TIME
      ? `${MACRO.VERSION} (built ${MACRO.BUILD_TIME})`
      : MACRO.VERSION,
  }
}

const version = {
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  // Internal-only slash command: regular users get the version from the CLI
  // `--version` flag. Kept gated so /help stays focused on user-facing commands.
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
