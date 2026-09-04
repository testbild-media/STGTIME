import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class SystemService {
  constructor({ helper = '/usr/local/libexec/stgtime-system' } = {}) { this.helper = helper }

  async setTimeZone(timeZone) {
    if (process.platform !== 'linux') return { applied: false, reason: 'System time-zone changes are available on Raspberry Pi only.' }
    const { stdout } = await run('sudo', [this.helper, 'timezone', timeZone], { timeout: 15_000 })
    return { applied: true, message: stdout.trim(), timeZone }
  }
}
