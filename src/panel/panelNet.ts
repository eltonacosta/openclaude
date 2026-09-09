import { networkInterfaces } from 'node:os'

export function getLanAddresses(): string[] {
  const out: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      // Skip link-local ranges that phones rarely route to.
      if (addr.address.startsWith('169.254.')) continue
      out.push(addr.address)
    }
  }
  return [...new Set(out)]
}

export function formatLocalUrl(port: number, host: string): string {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host
  return `http://${displayHost}:${port}`
}
