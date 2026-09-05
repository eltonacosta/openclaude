import { Box, Text } from '../ink.js'
import { BRAND_TAGLINE } from '../constants/brand.js'
import { detectProvider } from './StartupScreen.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

/**
 * Compact Orbit Code header pinned at the top of the Ink UI.
 *
 * The pre-Ink splash (printStartupScreen) is plain stdout: ctrl+l's
 * forceRedraw erases it and Ink only repaints its own tree. Rendering the
 * header inside the tree keeps it alive across redraws.
 */
export function StartupHeader(): React.ReactElement {
  const p = detectProvider()
  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION
  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Box>
        <Text bold color="brand">
          ORBIT CODE
        </Text>
        <Text dimColor> · {BRAND_TAGLINE} · </Text>
        <Text color="brand">oc v{version}</Text>
      </Box>
      <Box>
        <Text dimColor>
          {p.name} · {p.model}
        </Text>
      </Box>
    </Box>
  )
}
