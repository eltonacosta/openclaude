import { describe, expect, test } from 'bun:test'
import { generatePassword, hashPassword, verifyPassword } from './panelAuth.js'

describe('panelAuth', () => {
  test('hash + verify round-trips', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  test('rejects malformed hashes', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$1$2$3$zz$zz')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
  })

  test('generated passwords use an unambiguous alphabet', () => {
    for (let i = 0; i < 10; i += 1) {
      const password = generatePassword()
      expect(password).toHaveLength(20)
      expect(password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/)
    }
  })
})
