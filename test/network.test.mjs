import test from 'node:test'
import assert from 'node:assert/strict'
import { NetworkService } from '../src/network/service.mjs'

test('NetworkManager status exposes the active Ethernet lease', async () => {
  const runner = async (_command, args) => {
    if (args.includes('DEVICE,TYPE,STATE')) return { stdout: 'eth0:ethernet:connected\nwlan0:wifi:disconnected\n' }
    if (args[1] === 'IP4.ADDRESS') return { stdout: '192.0.2.10/24\n' }
    if (args[1] === 'IP4.GATEWAY') return { stdout: '192.0.2.1\n' }
    if (args[1] === 'IP4.DNS') return { stdout: '192.0.2.53\n198.51.100.53\n' }
    throw new Error(`Unexpected nmcli arguments: ${args.join(' ')}`)
  }
  const service = new NetworkService({ runner, platform: 'linux' })
  assert.deepEqual(await service.ethernetStatus(), {
    interface: 'eth0',
    address: '192.0.2.10/24',
    gateway: '192.0.2.1',
    dns: '192.0.2.53, 198.51.100.53'
  })
})

test('network helper errors retain their actionable stderr message', async () => {
  const runner = async () => { throw Object.assign(new Error('failed'), { stderr: 'Wi-Fi is unavailable' }) }
  const service = new NetworkService({ runner, platform: 'linux' })
  await assert.rejects(service.apply('hotspot-on', { hotspotSsid: 'STGTIME', hotspotPassword: 'stagetimer' }), error => {
    assert.equal(error.status, 400)
    assert.equal(error.message, 'Wi-Fi is unavailable')
    return true
  })
})
