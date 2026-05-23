import { describe, expect, it } from 'vitest'
import { DEFAULT_DEV_BIND_HOST, type ResolvedDevHostMode } from '../scripts/dev-host-mode'
import { buildWslLanRelayPlan, isWslRuntime } from '../scripts/wsl-lan-relay'

const enabledWildcardHostMode: ResolvedDevHostMode = {
  enabled: true,
  bindHost: DEFAULT_DEV_BIND_HOST,
  requestedValue: 'true',
  source: 'npm-config',
}

describe('isWslRuntime', () => {
  it('detects WSL from environment or proc version', () => {
    expect(isWslRuntime({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: null })).toBe(true)
    expect(isWslRuntime({ platform: 'linux', env: {}, procVersion: 'Linux version 6.6.87.2-microsoft-standard-WSL2' })).toBe(true)
    expect(isWslRuntime({ platform: 'linux', env: {}, procVersion: 'Linux version 6.6.87-generic' })).toBe(false)
    expect(isWslRuntime({ platform: 'darwin', env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: null })).toBe(false)
  })
})

describe('buildWslLanRelayPlan', () => {
  it('builds Windows LAN relay URLs for WSL wildcard LAN sharing', () => {
    const plan = buildWslLanRelayPlan({
      hostMode: enabledWildcardHostMode,
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: true,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40', '10.0.0.4'],
    })

    expect(plan.enabled).toBe(true)
    expect(plan.targetAddress).toBe('172.25.190.136')
    expect(plan.frontendUrls).toEqual([
      'http://192.168.1.40:5173',
      'http://10.0.0.4:5173',
    ])
    expect(plan.docsUrls).toEqual([
      'http://192.168.1.40:5174',
      'http://10.0.0.4:5174',
    ])
    expect(plan.endpoints).toHaveLength(4)
  })

  it('does not relay outside WSL or when explicit host binding is already configured', () => {
    expect(buildWslLanRelayPlan({
      hostMode: enabledWildcardHostMode,
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: false,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40'],
    })).toMatchObject({ enabled: false, reason: 'Runtime is not WSL.' })

    expect(buildWslLanRelayPlan({
      hostMode: { enabled: true, bindHost: '192.168.1.40', requestedValue: '192.168.1.40', source: 'env' },
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: true,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40'],
    })).toMatchObject({ enabled: false, reason: 'Explicit host binding is already configured.' })
  })

  it('does not advertise WSL NAT addresses when no Windows LAN address is detected', () => {
    expect(buildWslLanRelayPlan({
      hostMode: enabledWildcardHostMode,
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: true,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: [],
    })).toMatchObject({
      enabled: false,
      reason: 'No Windows LAN address was detected.',
      frontendUrls: [],
      docsUrls: [],
    })
  })
})
