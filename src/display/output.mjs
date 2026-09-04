import { spawn } from 'node:child_process'

export class DisplayOutput {
  constructor(settings) {
    this.settings = settings
    this.bridge = null
    this.available = settings.driver === 'simulator'
    this.error = null
  }

  start() {
    if (this.settings.driver !== 'hub75') return
    const args = [
      `--led-rows=${this.settings.height}`,
      `--led-cols=${this.settings.width}`,
      `--led-gpio-mapping=${this.settings.gpioMapping}`,
      `--led-slowdown-gpio=${this.settings.gpioSlowdown}`,
      `--led-scan-mode=${this.settings.scanMode}`,
      `--led-pwm-bits=${this.settings.pwmBits}`,
      `--led-pwm-lsb-nanoseconds=${this.settings.pwmLsbNanoseconds}`,
      `--led-limit-refresh=${this.settings.limitRefreshRateHz}`,
      `--led-brightness=${this.settings.brightness}`
    ]
    try {
      const bridge = process.env.STGTIME_MATRIX_BRIDGE || '/usr/local/libexec/stgtime-matrix'
      this.bridge = process.platform === 'linux'
        ? spawn('sudo', [bridge, ...args], { stdio: ['pipe', 'ignore', 'pipe'] })
        : spawn(bridge, args, { stdio: ['pipe', 'ignore', 'pipe'] })
      this.bridge.stderr.on('data', data => { this.error = String(data).trim() })
      this.bridge.on('spawn', () => { this.available = true; this.error = null })
      this.bridge.on('exit', code => { this.available = false; this.error = `Matrix bridge exited with code ${code}` })
      this.bridge.on('error', error => { this.available = false; this.error = error.message })
    } catch (error) { this.error = error.message }
  }

  write(frame) {
    if (!this.bridge?.stdin?.writable) return
    const header = Buffer.alloc(4); header.writeUInt32BE(frame.pixels.length)
    this.bridge.stdin.write(Buffer.concat([header, frame.pixels]))
  }

  status() { return { driver: this.settings.driver, available: this.available, error: this.error } }
  reconfigure(settings) {
    const changed = JSON.stringify(this.settings) !== JSON.stringify(settings)
    this.settings = settings
    if (changed) { this.stop(); this.bridge = null; this.available = settings.driver === 'simulator'; this.error = null; this.start() }
  }
  stop() { this.bridge?.kill('SIGTERM') }
}
