import { describe, expect, it } from 'vitest'
import { DEFAULT_DEV_BIND_HOST, type ResolvedDevHostMode } from '../scripts/dev-host-mode'
import { buildWslLanAccessPlan, isWslRuntime } from '../scripts/wsl-lan-access'

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

describe('buildWslLanAccessPlan', () => {
  it('builds Windows LAN URLs and explicit portproxy guidance for WSL wildcard LAN sharing', () => {
    const plan = buildWslLanAccessPlan({
      hostMode: enabledWildcardHostMode,
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: true,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40', '10.0.0.4'],
    })

    expect(plan.enabled).toBe(true)
    expect(plan.wslTargetAddress).toBe('172.25.190.136')
    expect(plan.frontendUrls).toEqual([
      'http://192.168.1.40:5173',
      'http://10.0.0.4:5173',
    ])
    expect(plan.docsUrls).toEqual([
      'http://192.168.1.40:5174',
      'http://10.0.0.4:5174',
    ])
    expect(plan.setupCommands).toHaveLength(1)
    expect(plan.setupCommands[0]).toBe(
      'netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5173 connectaddress=172.25.190.136 connectport=5173; ' +
      'netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5174 connectaddress=172.25.190.136 connectport=5174; ' +
      'Remove-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -ErrorAction SilentlyContinue; ' +
      'New-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173,5174 -Profile Private',
    )
    expect(plan.cleanupCommands).toEqual([
      'netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5173; ' +
      'netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=5174; ' +
      'Remove-NetFirewallRule -DisplayName "LoopTroop Dev LAN" -ErrorAction SilentlyContinue',
    ])
  })

  it('does not apply outside WSL or when explicit host binding is already configured', () => {
    expect(buildWslLanAccessPlan({
      hostMode: enabledWildcardHostMode,
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: false,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40'],
    })).toMatchObject({ enabled: false, reason: 'Runtime is not WSL.' })

    expect(buildWslLanAccessPlan({
      hostMode: { enabled: true, bindHost: '192.168.1.40', requestedValue: '192.168.1.40', source: 'env' },
      frontendPort: 5173,
      docsPort: 5174,
      isWsl: true,
      wslAddresses: ['172.25.190.136'],
      windowsAddresses: ['192.168.1.40'],
    })).toMatchObject({ enabled: false, reason: 'Explicit host binding is already configured.' })
  })

  it('does not advertise WSL NAT addresses as directly reachable LAN URLs', () => {
    expect(buildWslLanAccessPlan({
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
