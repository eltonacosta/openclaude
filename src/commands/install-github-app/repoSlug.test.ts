import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('eltonacosta/openclaude'), 'eltonacosta/openclaude')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/eltonacosta/openclaude'),
    'eltonacosta/openclaude',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/eltonacosta/openclaude.git'),
    'eltonacosta/openclaude',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:eltonacosta/openclaude.git'),
    'eltonacosta/openclaude',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/eltonacosta/openclaude'),
    'eltonacosta/openclaude',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/eltonacosta/openclaude'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/eltonacosta/openclaude'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/eltonacosta/openclaude'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/eltonacosta/openclaude'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/eltonacosta/openclaude'),
    null,
  )
})
