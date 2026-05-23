import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEV_BIND_HOST,
  getDevLanUrls,
  listLanAddresses,
  LOOPTROOP_DEV_HOST,
  NPM_CONFIG_HOST,
  resolveDevHostMode,
  type ResolvedDevHostMode,
} from '../scripts/dev-host-mode'

const hostModeEnabled = (bindHost: string): ResolvedDevHostMode => ({
  enabled: true,
  bindHost,
  requestedValue: bindHost,
  source: 'env',
})

describe('resolveDevHostMode', () => {
  it('keeps LAN sharing disabled by default', () => {
    expect(resolveDevHostMode({ env: {} })).toEqual({ enabled: false })
  })

  it('supports npm run config flags without the argument forwarding separator', () => {
    expect(resolveDevHostMode({
      env: { [NPM_CONFIG_HOST]: 'true' },
    })).toEqual({
      enabled: true,
      bindHost: DEFAULT_DEV_BIND_HOST,
      requestedValue: 'true',
      source: 'npm-config',
    })
  })

  it('supports an explicit npm host value for advanced binding', () => {
    expect(resolveDevHostMode({
      env: { [NPM_CONFIG_HOST]: '192.168.1.50' },
    })).toEqual({
      enabled: true,
      bindHost: '192.168.1.50',
      requestedValue: '192.168.1.50',
      source: 'npm-config',
    })
  })

  it('supports an environment fallback for direct watcher use', () => {
    expect(resolveDevHostMode({
      env: { [LOOPTROOP_DEV_HOST]: '1' },
    })).toEqual({
      enabled: true,
      bindHost: DEFAULT_DEV_BIND_HOST,
      requestedValue: '1',
      source: 'env',
    })
  })

  it('lets npm config disable the environment fallback', () => {
    expect(resolveDevHostMode({
      env: {
        [NPM_CONFIG_HOST]: '',
        [LOOPTROOP_DEV_HOST]: '1',
      },
    })).toEqual({ enabled: false })
  })

  it('rejects invalid host values with a clear command hint', () => {
    expect(() => resolveDevHostMode({
      env: { [NPM_CONFIG_HOST]: 'http://0.0.0.0:5173' },
    })).toThrow('Invalid dev host "http://0.0.0.0:5173". Use npm run dev --host or npm run dev --host=0.0.0.0.')

    expect(() => resolveDevHostMode({
      env: { [LOOPTROOP_DEV_HOST]: 'bad host' },
    })).toThrow(`Invalid dev host "bad host". Use ${LOOPTROOP_DEV_HOST}=1 or ${LOOPTROOP_DEV_HOST}=0.0.0.0.`)
  })
})

describe('LAN URL formatting', () => {
  it('formats all detected non-loopback IPv4 interfaces for wildcard host mode', () => {
    const urls = getDevLanUrls({
      hostMode: hostModeEnabled(DEFAULT_DEV_BIND_HOST),
      port: 5173,
      interfaces: {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8', mac: '00:00:00:00:00:00', netmask: '255.0.0.0' }],
        wifi0: [{ address: '192.168.1.22', family: 'IPv4', internal: false, cidr: '192.168.1.22/24', mac: '00:00:00:00:00:01', netmask: '255.255.255.0' }],
        eth0: [{ address: '10.0.0.8', family: 'IPv4', internal: false, cidr: '10.0.0.8/24', mac: '00:00:00:00:00:02', netmask: '255.255.255.0' }],
      },
    })

    expect(urls).toEqual([
      'http://192.168.1.22:5173',
      'http://10.0.0.8:5173',
    ])
  })

  it('returns no LAN URLs when wildcard host mode has no detected network interface', () => {
    expect(getDevLanUrls({
      hostMode: hostModeEnabled(DEFAULT_DEV_BIND_HOST),
      port: 5173,
      interfaces: {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8', mac: '00:00:00:00:00:00', netmask: '255.0.0.0' }],
      },
    })).toEqual([])
  })

  it('uses an explicit non-loopback host directly', () => {
    expect(getDevLanUrls({
      hostMode: hostModeEnabled('devbox.local'),
      port: 5174,
      interfaces: {},
    })).toEqual(['http://devbox.local:5174'])
  })

  it('does not advertise loopback-only host values as LAN addresses', () => {
    expect(getDevLanUrls({
      hostMode: hostModeEnabled('localhost'),
      port: 5173,
      interfaces: {},
    })).toEqual([])
  })

  it('deduplicates detected LAN addresses', () => {
    expect(listLanAddresses({
      wifi0: [{ address: '192.168.1.22', family: 'IPv4', internal: false, cidr: '192.168.1.22/24', mac: '00:00:00:00:00:01', netmask: '255.255.255.0' }],
      bridge0: [{ address: '192.168.1.22', family: 'IPv4', internal: false, cidr: '192.168.1.22/24', mac: '00:00:00:00:00:02', netmask: '255.255.255.0' }],
    })).toEqual([{ interfaceName: 'wifi0', address: '192.168.1.22' }])
  })
})
