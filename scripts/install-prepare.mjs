#!/usr/bin/env node
/**
 * Prepare hook for installs from the GitHub URL (and local `npm install`).
 *
 * npm runs the `prepare` script when installing from a git URL, in a bare
 * clone that has NO node_modules. We must install dependencies and build
 * `dist/` there so the CLI works out of the box.
 *
 * The catch: `bun install` itself re-runs the root package's `prepare`
 * script, which would recurse forever (`bun install` -> prepare -> bun
 * install -> ...). We guard against that with an env var: the nested
 * invocation sees it set and exits immediately.
 */
import { execSync } from 'node:child_process'

if (process.env.OPENCLAUDE_INTERNAL_PREPARE === '1') {
  // Nested `bun install` re-triggered this prepare — nothing to do.
  process.exit(0)
}

process.env.OPENCLAUDE_INTERNAL_PREPARE = '1'

try {
  execSync('bun install', { stdio: 'inherit', shell: true })
  execSync('bun run build', { stdio: 'inherit', shell: true })
} catch (err) {
  // Surface the failing command's output; npm reports the exit code.
  process.exit(typeof err.status === 'number' ? err.status : 1)
}