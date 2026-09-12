import { describe, expect, test } from 'bun:test'
import {
  MAX_PLAUSIBLE_TPS,
  MIN_TPS_ELAPSED_MS,
  computeSessionAverageTps,
  computeTokensPerSecond,
  estimateTokensFromText,
  sanitizeTokensPerSecond,
} from './tokensPerSecond.js'

describe('computeTokensPerSecond', () => {
  test('computes tokens divided by elapsed seconds', () => {
    // 87 tokens over 1000ms => 87 tok/s
    expect(computeTokensPerSecond(87, 1000)).toBe(87)
    // 100 tokens over 2000ms => 50 tok/s
    expect(computeTokensPerSecond(100, 2000)).toBe(50)
    // fractional seconds
    expect(computeTokensPerSecond(10, 1000)).toBe(10)
    expect(computeTokensPerSecond(150, 1500)).toBe(100)
  })

  test('returns null for zero or negative inputs', () => {
    expect(computeTokensPerSecond(0, 1000)).toBeNull()
    expect(computeTokensPerSecond(87, 0)).toBeNull()
    expect(computeTokensPerSecond(87, -100)).toBeNull()
    expect(computeTokensPerSecond(-1, 1000)).toBeNull()
  })

  test('returns null for non-finite inputs', () => {
    expect(computeTokensPerSecond(Number.NaN, 1000)).toBeNull()
    expect(computeTokensPerSecond(87, Number.POSITIVE_INFINITY)).toBeNull()
    expect(computeTokensPerSecond(87, Number.NaN)).toBeNull()
  })

  test('returns null below the minimum window instead of a burst-inflated rate', () => {
    // The reported bug: a buffered response (or one big chunk) lands in a tiny
    // window and the estimate reads as four digits. 6000 tokens over 20ms
    // would be 300000 tok/s; the floor rejects the sample outright.
    expect(computeTokensPerSecond(6000, 20)).toBeNull()
    expect(computeTokensPerSecond(10, 250)).toBeNull()
    expect(computeTokensPerSecond(300, MIN_TPS_ELAPSED_MS - 1)).toBeNull()
    // At the floor the same window is measurable.
    expect(computeTokensPerSecond(300, MIN_TPS_ELAPSED_MS)).toBe(300)
  })

  test('rejects rates above the plausibility ceiling', () => {
    // Cumulative usage replayed as a trailing delta: the full token count over
    // a near-zero residual window.
    expect(computeTokensPerSecond(5000, 1000)).toBeNull()
    expect(computeTokensPerSecond(1333, 1000)).toBeNull()
    expect(computeTokensPerSecond(MAX_PLAUSIBLE_TPS + 1, 1000)).toBeNull()
    // Fast-but-real hardware stays visible.
    expect(computeTokensPerSecond(800, 1000)).toBe(800)
    expect(computeTokensPerSecond(MAX_PLAUSIBLE_TPS, 1000)).toBe(
      MAX_PLAUSIBLE_TPS,
    )
  })
})

describe('sanitizeTokensPerSecond', () => {
  test('passes plausible rates through untouched', () => {
    expect(sanitizeTokensPerSecond(0.5)).toBe(0.5)
    expect(sanitizeTokensPerSecond(87)).toBe(87)
    expect(sanitizeTokensPerSecond(MAX_PLAUSIBLE_TPS)).toBe(MAX_PLAUSIBLE_TPS)
  })

  test('rejects non-finite, non-positive, and implausible rates', () => {
    expect(sanitizeTokensPerSecond(0)).toBeNull()
    expect(sanitizeTokensPerSecond(-12)).toBeNull()
    expect(sanitizeTokensPerSecond(Number.NaN)).toBeNull()
    expect(sanitizeTokensPerSecond(Number.POSITIVE_INFINITY)).toBeNull()
    expect(sanitizeTokensPerSecond(MAX_PLAUSIBLE_TPS + 0.1)).toBeNull()
    expect(sanitizeTokensPerSecond(15000)).toBeNull()
  })
})

describe('estimateTokensFromText', () => {
  test('estimates ~4 chars per token', () => {
    expect(estimateTokensFromText(0)).toBe(0)
    expect(estimateTokensFromText(4)).toBe(1)
    expect(estimateTokensFromText(400)).toBe(100)
    // rounding: 6 chars => 1.5 => 2
    expect(estimateTokensFromText(6)).toBe(2)
  })

  test('clamps negative input to zero', () => {
    expect(estimateTokensFromText(-10)).toBe(0)
  })
})

describe('computeSessionAverageTps', () => {
  test('weights samples by summed duration', () => {
    // 100 tokens over 2s + 300 tokens over 3s = 400 tokens / 5s = 80 tok/s
    expect(computeSessionAverageTps(400, 5000)).toBe(80)
  })

  test('returns null until a real sample exists', () => {
    expect(computeSessionAverageTps(0, 5000)).toBeNull()
    expect(computeSessionAverageTps(100, 0)).toBeNull()
    expect(computeSessionAverageTps(0, 0)).toBeNull()
    expect(computeSessionAverageTps(-5, 5000)).toBeNull()
  })

  test('returns null for non-finite inputs', () => {
    expect(computeSessionAverageTps(Number.NaN, 1000)).toBeNull()
    expect(computeSessionAverageTps(100, Number.NaN)).toBeNull()
  })
})
