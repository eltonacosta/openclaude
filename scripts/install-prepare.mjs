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
import { closeSync, fsyncSync, openSync, readFileSync, statSync } from 'node:fs'

if (process.env.OPENCLAUDE_INTERNAL_PREPARE === '1') {
  // Nested `bun install` re-triggered this prepare — nothing to do.
  process.exit(0)
}

process.env.OPENCLAUDE_INTERNAL_PREPARE = '1'

try {
  execSync('bun install', { stdio: 'inherit', shell: true })
  execSync('bun run build', { stdio: 'inherit', shell: true })

  // npm packs the freshly built directory immediately after prepare to
  // install the package. If a multi-MB bundle is not fully flushed to disk
  // yet, npm's tar read can abort with `unexpected EOF` and kill the whole
  // install. Force each dist artifact fully onto disk (fsync + full
  // readback with a size check) so npm's later read is deterministic.
  for (const file of ['dist/cli.mjs', 'dist/sdk.mjs']) {
    const st = statSync(file)
    const fd = openSync(file, 'r')
    try {
      try {
        fsyncSync(fd)
      } catch {
        // fsync on a read-only fd is best effort.
      }
    } finally {
      closeSync(fd)
    }
    // The readback also serves as a buffer-cache warm: npm's tar read of this
    // file will hit the page cache instead of a cold, still-in-flight write.
    const read = readFileSync(file)
    if (read.length !== st.size) {
      throw new Error(
        `short read after build: ${file} (${read.length} of ${st.size} bytes)`,
      )
    }
    console.log(`  ✔ flushed ${file} (${st.size} bytes)`)
  }
} catch (err) {
  // Surface the failing command's output; npm reports the exit code.
  process.exit(typeof err.status === 'number' ? err.status : 1)
}