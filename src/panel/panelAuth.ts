import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

// scrypt parameters: interactive-login latency (~100ms) with strong memory cost.
// Sync API keeps the login path free of promisify typing drift across Node/Bun.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64
const SALT_LEN = 16

export type PanelConfig = {
  passwordHash?: string
}

export function getPanelConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'panel.json')
}

export async function loadPanelConfig(): Promise<PanelConfig> {
  try {
    const raw = await readFile(getPanelConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PanelConfig>
    if (parsed && typeof parsed === 'object' && (parsed.passwordHash === undefined || typeof parsed.passwordHash === 'string')) {
      return { passwordHash: parsed.passwordHash }
    }
  } catch {
    // Missing or corrupt config behaves as "no password set".
  }
  return {}
}

export async function savePanelPasswordHash(passwordHash: string): Promise<void> {
  const path = getPanelConfigPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify({ passwordHash }, null, 2) + '\n', {
    mode: 0o600,
  })
  await chmod(path, 0o600).catch(() => {})
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const derived = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltHex, hashHex] = parts as [string, string, string, string, string, string]
  const N = Number.parseInt(n ?? '', 10)
  const R = Number.parseInt(r ?? '', 10)
  const P = Number.parseInt(p ?? '', 10)
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex ?? '', 'hex')
    expected = Buffer.from(hashHex ?? '', 'hex')
  } catch {
    return false
  }
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false
  let derived: Buffer
  try {
    derived = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P })
  } catch {
    return false
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export function generatePassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += alphabet[(bytes[i] as number) % alphabet.length]
  }
  return out
}

export function createSessionToken(): string {
  return randomBytes(32).toString('hex')
}
