import test from 'node:test'
import assert from 'node:assert/strict'
import { TimerEngine } from '../src/core/timer.mjs'

test('countdown is based on elapsed time and stops exactly at zero', () => {
  let now = 1000
  const timer = new TimerEngine({ now: () => now, durationMs: 10_000 })
  timer.start(); now += 2345
  assert.equal(timer.status().valueMs, 7655)
  now += 10_000; timer.sync()
  assert.deepEqual(timer.status(), { mode: 'countdown', running: false, durationMs: 10_000, valueMs: 0, remainingMs: 0, continueNegative: false })
})

test('countdown can continue through zero and be stopped', () => {
  let now = 0
  const timer = new TimerEngine({ now: () => now, durationMs: 1000, continueNegative: true })
  timer.start(); now = 2500
  assert.equal(timer.status().valueMs, -1500)
  timer.stop(); now = 9000
  assert.equal(timer.status().valueMs, -1500)
})

test('stopwatch counts upward and reset returns to zero', () => {
  let now = 10
  const timer = new TimerEngine({ now: () => now, mode: 'stopwatch', durationMs: 60_000 })
  timer.start(); now = 5010
  assert.equal(timer.status().valueMs, 5000)
  timer.reset()
  assert.equal(timer.status().valueMs, 0)
})

test('jog updates a running timer without losing elapsed time', () => {
  let now = 0
  const timer = new TimerEngine({ now: () => now, durationMs: 60_000 })
  timer.start(); now = 5000; timer.jog(10_000); now = 6000
  assert.equal(timer.status().valueMs, 64_000)
  assert.equal(timer.status().durationMs, 70_000)
})
