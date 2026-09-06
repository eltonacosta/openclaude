import { describe, expect, test } from 'bun:test'
import {
  computeSessionAverageTps,
  computeTokensPerSecond,
  estimateTokensFromText,
} from './tokensPerSecond.js'

describe('computeTokensPerSecond', () => {
  test('computes tokens divided by elapsed seconds', () => {
    // 87 tokens over 1000ms => 87 tok/s
    expect(computeTokensPerSecond(87, 1000)).toBe(87)
    // 100 tokens over 2000ms => 50 tok/s
    expect(computeTokensPerSecond(100, 2000)).toBe(50)
    // fractional seconds
    expect(computeTokensPerSecond(10, 250)).toBe(40)
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
