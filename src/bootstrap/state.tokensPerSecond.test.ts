import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  addSessionTpsSample,
  clearLiveTokensPerSecond,
  getLastRequestTokensPerSecond,
  getLiveTokensPerSecond,
  getLiveTokensPerSecondIsEstimated,
  getSessionAverageTokensPerSecond,
  resetStateForTests,
  setLastRequestTokensPerSecond,
  setLiveTokensPerSecond,
} from './state.js'

// Covers the tokens-per-second speedometer plumbing on STATE: live value
// lifecycle, last-request bookkeeping, and the duration-weighted session
// aggregate (see utils/tokensPerSecond.ts for the pure math).

let savedNodeEnv: string | undefined

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  resetStateForTests()
})

afterEach(() => {
  resetStateForTests()
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
})

test('live tok/s starts empty, can be set, and clears back to empty', () => {
  expect(getLiveTokensPerSecond()).toBeNull()
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)

  setLiveTokensPerSecond(87.5)
  expect(getLiveTokensPerSecond()).toBe(87.5)
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)

  setLiveTokensPerSecond(42, true)
  expect(getLiveTokensPerSecond()).toBe(42)
  expect(getLiveTokensPerSecondIsEstimated()).toBe(true)

  clearLiveTokensPerSecond()
  expect(getLiveTokensPerSecond()).toBeNull()
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)
})

test('live tok/s falls back to the last request between turns', () => {
  // The streaming layer clears the live value at every turn end; the spinner
  // keeps showing the last real sample instead of blinking out.
  expect(getLiveTokensPerSecond()).toBeNull()

  setLastRequestTokensPerSecond(120)
  expect(getLiveTokensPerSecond()).toBe(120)
  // The fallback serves a measured value, never an estimate.
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)

  // An active stream overrides the fallback, estimates included.
  setLiveTokensPerSecond(200, true)
  expect(getLiveTokensPerSecond()).toBe(200)
  expect(getLiveTokensPerSecondIsEstimated()).toBe(true)

  clearLiveTokensPerSecond()
  expect(getLiveTokensPerSecond()).toBe(120)
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)
})

test('last-request tok/s round-trips and survives clearing the live value', () => {
  expect(getLastRequestTokensPerSecond()).toBeNull()
  setLastRequestTokensPerSecond(120)
  setLiveTokensPerSecond(200)
  clearLiveTokensPerSecond()
  expect(getLastRequestTokensPerSecond()).toBe(120)
})

test('session average weights samples by duration and skips invalid samples', () => {
  expect(getSessionAverageTokensPerSecond()).toBeNull()

  addSessionTpsSample(0, 1000) // ignored: no tokens
  addSessionTpsSample(100, 0) // ignored: no duration
  addSessionTpsSample(-5, 1000) // ignored: negative tokens
  expect(getSessionAverageTokensPerSecond()).toBeNull()

  // 100 tokens over 2s + 300 tokens over 3s = 400 tokens / 5s
  addSessionTpsSample(100, 2000)
  addSessionTpsSample(300, 3000)
  expect(getSessionAverageTokensPerSecond()).toBe(80)
})

test('resetStateForTests clears live, last-request, and session aggregates', () => {
  setLiveTokensPerSecond(50, true)
  setLastRequestTokensPerSecond(120)
  addSessionTpsSample(400, 5000)

  resetStateForTests()

  expect(getLiveTokensPerSecond()).toBeNull()
  expect(getLiveTokensPerSecondIsEstimated()).toBe(false)
  expect(getLastRequestTokensPerSecond()).toBeNull()
  expect(getSessionAverageTokensPerSecond()).toBeNull()
})
