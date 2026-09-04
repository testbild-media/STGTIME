import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class NetworkService {
  constructor({ helper = process.env.STGTIME_NETWORK_HELPER || '/usr/local/libexec/stgtime-network', runner = run, platform = process.platform } = {}) {
    this.helper = helper
    this.runner = runner
    this.platform = platform
  }

  addresses() {
    return Object.entries(networkInterfaces()).flatMap(([name, items]) => (items || [])
      .filter(item => item.family === 'IPv4' && !item.internal)
      .map(item => ({ interface: name, address: item.address })))
  }

  primaryAddress() { return this.addresses()[0]?.address || 'stgtime.local' }

  async ethernetStatus() {
    const fallback = this.addresses().find(item => /^(eth|en)/i.test(item.interface)) || this.addresses()[0] || {}
    if (this.platform !== 'linux') return { interface: fallback.interface || '', address: fallback.address || '', gateway: '', dns: '' }
    const options = { timeout: 10_000, env: { ...process.env, LC_ALL: 'C' } }
    try {
      const { stdout } = await this.runner('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device', 'status'], options)
      const devices = stdout.trim().split(/\r?\n/).map(line => line.split(':')).filter(parts => parts[1] === 'ethernet')
      const device = devices.find(parts => parts[2] === 'connected')?.[0] || devices[0]?.[0]
      if (!device) return { interface: '', address: '', gateway: '', dns: '' }
      const read = async field => (await this.runner('nmcli', ['-g', field, 'device', 'show', device], options)).stdout.trim().split(/\r?\n/).filter(Boolean)
      const [addresses, gateways, dns] = await Promise.all([read('IP4.ADDRESS'), read('IP4.GATEWAY'), read('IP4.DNS')])
      return { interface: device, address: addresses[0] || '', gateway: gateways[0] || '', dns: dns.join(', ') }
    } catch (error) {
      return { interface: fallback.interface || '', address: fallback.address || '', gateway: '', dns: '', error: String(error.stderr || error.message).trim() }
    }
  }

  async apply(action, settings) {
    if (this.platform !== 'linux') return { applied: false, reason: 'Network changes are available on Raspberry Pi only.' }
    const args = action === 'hotspot-on'
      ? [action, settings.hotspotSsid, settings.hotspotPassword]
      : action === 'ethernet-static'
        ? [action, settings.ethernetAddress, settings.ethernetGateway, settings.ethernetDns]
        : [action]
    try {
      const { stdout } = await this.runner('sudo', [this.helper, ...args], { timeout: 30_000 })
      return { applied: true, message: stdout.trim() }
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || 'Network operation failed').trim()
      throw Object.assign(new Error(detail), { status: 400 })
    }
  }
}
