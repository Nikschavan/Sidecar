/**
 * Network utilities for getting local and external IPs
 */

import { networkInterfaces } from 'os'

export interface NetworkAddress {
  name: string
  ip: string
  type: 'local' | 'lan' | 'tailscale' | 'other'
}

/**
 * Get all network addresses where the server is accessible
 */
export function getNetworkAddresses(): NetworkAddress[] {
  const addresses: NetworkAddress[] = []
  const nets = networkInterfaces()

  // Always add localhost first
  addresses.push({
    name: 'Local',
    ip: 'localhost',
    type: 'local',
  })

  for (const [name, interfaces] of Object.entries(nets)) {
    if (!interfaces) continue

    for (const net of interfaces) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.internal || net.family !== 'IPv4') continue

      // Detect Tailscale interface
      if (name.toLowerCase().includes('tailscale') || name.startsWith('utun')) {
        // Tailscale uses 100.x.x.x range
        if (net.address.startsWith('100.')) {
          addresses.push({
            name: 'Tailscale',
            ip: net.address,
            type: 'tailscale',
          })
          continue
        }
      }

      // Detect LAN addresses
      if (
        net.address.startsWith('192.168.') ||
        net.address.startsWith('10.') ||
        net.address.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
      ) {
        addresses.push({
          name: 'Network',
          ip: net.address,
          type: 'lan',
        })
        continue
      }

      // Other addresses
      addresses.push({
        name: name,
        ip: net.address,
        type: 'other',
      })
    }
  }

  return addresses
}

/**
 * Format network addresses for display
 */
export function formatNetworkUrls(port: number, protocol: 'http' | 'ws' = 'http'): string {
  const addresses = getNetworkAddresses()
  const lines: string[] = []

  for (const addr of addresses) {
    const url = `${protocol}://${addr.ip}:${port}`
    lines.push(`  ${addr.name.padEnd(10)} ${url}`)
  }

  return lines.join('\n')
}
