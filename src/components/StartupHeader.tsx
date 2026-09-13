import { Box, Text } from '../ink.js'
import { BRAND_TAGLINE } from '../constants/brand.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

/**
 * Compact Orbit Code header pinned at the top of the Ink UI.
 *
 * The pre-Ink splash (printStartupScreen) is plain stdout: ctrl+l's
 * forceRedraw erases it and Ink only repaints its own tree. Rendering the
 * header inside the tree keeps it alive across redraws.
 *
 * Brand-only: no provider/model line. The active model already shows in
 * the footer status line, and the provider fallback here leaked a stale
 * default (e.g. gpt-4o) when the Orbit Router was configured.
 */
export function StartupHeader(): React.ReactElement {
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
    </Box>
  )
}
