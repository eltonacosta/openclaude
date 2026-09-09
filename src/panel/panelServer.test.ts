import { describe, expect, test } from 'bun:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPanelRequestHandler, parseSessionCookie } from './panelServer.js'

function fakeReq(url: string, method = 'GET', cookie?: string): IncomingMessage {
  return {
    url,
    method,
    headers: cookie ? { cookie } : {},
  } as unknown as IncomingMessage
}

type FakeRes = ServerResponse & { body: string; status: number; sent: boolean }

function fakeRes(): FakeRes {
  const headers: Record<string, string> = {}
  const res = {
    body: '',
    status: 0,
    sent: false,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value
    },
    getHeader: (key: string) => headers[key.toLowerCase()],
    writeHead: (status: number) => {
      res.status = status
    },
    end: (chunk?: string) => {
      if (chunk) res.body += chunk
      res.sent = true
    },
  } as unknown as FakeRes
  return res
}

function sessionCookie(res: FakeRes): string {
  const setCookie = (res.getHeader as (key: string) => string)('set-cookie')
  const match = /oc_panel=([^;]+)/.exec(setCookie ?? '')
  if (!match) throw new Error('expected session cookie')
  return `oc_panel=${match[1]}`
}

describe('panelServer routes', () => {
  async function makeHandler() {
    return createPanelRequestHandler({
      version: () => '0.0.0-test',
      cwd: () => '/tmp/proj',
      localUrl: () => 'http://localhost:3100',
      lanUrls: () => [],
      sessions: {
        list: async () => [],
        readLog: async () => '',
      },
      spawnTask: async () => {
        throw new Error('not used here')
      },
      killTask: async () => {
        throw new Error('not used here')
      },
    })
  }

  test('public routes serve info + page, API requires auth', async () => {
    const { handle } = await makeHandler()

    const infoRes = fakeRes()
    await handle(fakeReq('/api/info'), infoRes)
    expect(infoRes.status).toBe(200)
    expect(JSON.parse(infoRes.body)).toMatchObject({ cwd: '/tmp/proj' })

    const tasksRes = fakeRes()
    await handle(fakeReq('/api/tasks'), tasksRes)
    expect(tasksRes.status).toBe(401)

    const rootRes = fakeRes()
    await handle(fakeReq('/'), rootRes)
    expect(rootRes.status).toBe(200)
    expect(rootRes.body).toContain('Orbit Code')
  })

  test('parseSessionCookie extracts the panel cookie', () => {
    const req = fakeReq('/', 'GET', 'other=1; oc_panel=abc123; x=2')
    expect(parseSessionCookie(req)).toBe('abc123')
    expect(parseSessionCookie(fakeReq('/'))).toBeNull()
  })

  test('session cookie helper round-trips', () => {
    const res = fakeRes()
    res.setHeader('Set-Cookie', 'oc_panel=tok123; Path=/; HttpOnly')
    expect(sessionCookie(res)).toBe('oc_panel=tok123')
  })
})
