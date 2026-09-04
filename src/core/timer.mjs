import { EventEmitter } from 'node:events'

const MODES = new Set(['countdown', 'stopwatch'])

export class TimerEngine extends EventEmitter {
  constructor({ now = () => performance.now(), mode = 'countdown', durationMs = 0, continueNegative = false } = {}) {
    super()
    this.now = now
    this.mode = MODES.has(mode) ? mode : 'countdown'
    this.durationMs = Math.max(0, Math.trunc(durationMs))
    this.valueAtAnchorMs = this.mode === 'countdown' ? this.durationMs : 0
    this.anchorMs = null
    this.running = false
    this.continueNegative = Boolean(continueNegative)
  }

  value(at = this.now()) {
    if (!this.running || this.anchorMs === null) return this.valueAtAnchorMs
    const elapsed = Math.max(0, at - this.anchorMs)
    const value = this.mode === 'countdown' ? this.valueAtAnchorMs - elapsed : this.valueAtAnchorMs + elapsed
    if (this.mode === 'countdown' && !this.continueNegative && value <= 0) return 0
    return value
  }

  sync(at = this.now()) {
    const current = this.value(at)
    if (this.running && this.mode === 'countdown' && !this.continueNegative && current <= 0) {
      this.valueAtAnchorMs = 0
      this.anchorMs = null
      this.running = false
      this.emit('changed', this.status(at))
    }
    return current
  }

  configure({ mode, durationMs, continueNegative } = {}) {
    const current = this.value()
    if (mode !== undefined && MODES.has(mode) && mode !== this.mode) {
      this.mode = mode
      this.running = false
      this.anchorMs = null
      this.valueAtAnchorMs = mode === 'countdown' ? this.durationMs : 0
    }
    if (durationMs !== undefined) {
      this.durationMs = Math.max(0, Math.trunc(durationMs))
      this.valueAtAnchorMs = this.mode === 'countdown' ? this.durationMs : Math.min(Math.max(0, current), this.durationMs)
      this.running = false
      this.anchorMs = null
    }
    if (continueNegative !== undefined) this.continueNegative = Boolean(continueNegative)
    this.emit('changed', this.status())
  }

  setTime(durationMs) {
    const value = Math.max(0, Math.trunc(durationMs))
    this.durationMs = value
    this.valueAtAnchorMs = this.mode === 'countdown' ? value : 0
    this.running = false
    this.anchorMs = null
    this.emit('changed', this.status())
  }

  jog(deltaMs) {
    const current = this.value()
    this.valueAtAnchorMs = Math.max(this.continueNegative ? Number.MIN_SAFE_INTEGER : 0, current + Math.trunc(deltaMs))
    if (this.mode === 'countdown') this.durationMs = Math.max(0, this.durationMs + Math.trunc(deltaMs))
    if (this.running) this.anchorMs = this.now()
    this.emit('changed', this.status())
  }

  start() {
    if (this.running) return
    if (this.mode === 'countdown' && this.valueAtAnchorMs <= 0 && !this.continueNegative) return
    this.anchorMs = this.now()
    this.running = true
    this.emit('changed', this.status())
  }

  stop() {
    if (!this.running) return
    this.valueAtAnchorMs = this.value()
    this.anchorMs = null
    this.running = false
    this.emit('changed', this.status())
  }

  toggle() { this.running ? this.stop() : this.start() }

  reset() {
    this.running = false
    this.anchorMs = null
    this.valueAtAnchorMs = this.mode === 'countdown' ? this.durationMs : 0
    this.emit('changed', this.status())
  }

  status(at = this.now()) {
    const valueMs = this.value(at)
    return {
      mode: this.mode,
      running: this.running && !(this.mode === 'countdown' && !this.continueNegative && valueMs <= 0),
      durationMs: this.durationMs,
      valueMs,
      remainingMs: this.mode === 'countdown' ? valueMs : Math.max(0, this.durationMs - valueMs),
      continueNegative: this.continueNegative
    }
  }
}
