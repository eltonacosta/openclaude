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
 * Shortest window a rate is computed over. Below a second the sample is
 * dominated by chunking granularity: one SSE event can carry a whole buffered
 * response, so 200 tokens divided by a 20ms window reads as 10000 tok/s. The
 * live spinner is prefixed with "~" for exactly this reason, and the persisted
 * last-request/session samples deserve the same floor.
 */
export const MIN_TPS_ELAPSED_MS = 1000

/**
 * Highest output rate treated as real generation speed rather than a
 * measurement artifact. Values above this are rejected, not clamped: showing
 * a capped "1000 tok/s" would be a different lie than showing nothing, and the
 * previous (honest) sample is a better fallback.
 *
 * Real artifacts that produce four-digit readings:
 * - burst delivery: a proxy or non-streaming-capable endpoint hands over the
 *   whole response at once, so a large token count lands in a tiny window;
 * - usage replay: a trailing message_delta re-reports cumulative
 *   output_tokens, which the final sample then divides by a near-zero window.
 * A generous ceiling keeps genuinely fast hardware (fast local models, Groq-
 * and Cerebras-class endpoints stream in the high hundreds) visible while
 * still rejecting the absurd.
 */
export const MAX_PLAUSIBLE_TPS = 1000

/** Rejects non-finite, non-positive, and implausibly fast rates. */
export function sanitizeTokensPerSecond(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  if (value > MAX_PLAUSIBLE_TPS) return null
  return value
}

/**
 * Output tokens generated per second.
 * Returns null when there is nothing meaningful to report — no tokens, a
 * window shorter than MIN_TPS_ELAPSED_MS, or a rate above MAX_PLAUSIBLE_TPS —
 * rather than fabricating a value. Every caller shares these two thresholds
 * here, so no path can compute a rate without them.
 */
export function computeTokensPerSecond(
  tokens: number,
  elapsedMs: number,
): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedMs)) return null
  if (tokens <= 0 || elapsedMs < MIN_TPS_ELAPSED_MS) return null
  return sanitizeTokensPerSecond(tokens / (elapsedMs / 1000))
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
