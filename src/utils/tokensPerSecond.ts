/**
 * Pure helpers for the tokens-per-second speedometer. No dependencies so they
 * can be unit-tested in isolation and imported from both the streaming layer
 * and UI components.
 */

/**
 * ~4 characters per token, matching the live spinner's token-count convention
 * (getCurrentResponseTokenCount in Spinner/SpinnerAnimationRow.tsx). Used only
 * as a fallback when a provider does not report usage mid-stream.
 */
const CHARS_PER_TOKEN = 4

/**
 * Output tokens generated per second.
 * Returns null when there is nothing meaningful to report (no tokens, or no
 * measurable elapsed time) rather than fabricating a zero.
 */
export function computeTokensPerSecond(
  tokens: number,
  elapsedMs: number,
): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedMs)) return null
  if (tokens <= 0 || elapsedMs <= 0) return null
  return tokens / (elapsedMs / 1000)
}

/** Estimated output-token count from streamed text length. */
export function estimateTokensFromText(chars: number): number {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN))
}

/**
 * Session-average tok/s, weighted by per-request streaming duration:
 * summed output tokens divided by summed generation time. Deliberately not
 * totalOutputTokens / totalAPIDuration, which would be dragged down by
 * retries and non-generation API time.
 * Returns null until at least one sample exists.
 */
export function computeSessionAverageTps(
  totalTokens: number,
  totalDurationMs: number,
): number | null {
  if (!Number.isFinite(totalTokens) || !Number.isFinite(totalDurationMs)) {
    return null
  }
  if (totalTokens <= 0 || totalDurationMs <= 0) return null
  return totalTokens / (totalDurationMs / 1000)
}
