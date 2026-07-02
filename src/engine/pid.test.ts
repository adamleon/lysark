import { describe, expect, it } from 'vitest'
import { PID } from './pid'
import { PidChannel } from './motion-system'

function run(opts: { kp: number; kd: number; ki?: number; min?: number; max?: number; setpoint?: number; seconds?: number }) {
  const channel = new PidChannel({
    x0: 0,
    pid: new PID({ kp: opts.kp, ki: opts.ki ?? 0, kd: opts.kd, outMin: -1000, outMax: 1000 }),
    min: opts.min,
    max: opts.max,
  })
  channel.setpoint = opts.setpoint ?? 1
  const dt = 1 / 240
  let peak = -Infinity
  const seconds = opts.seconds ?? 8
  for (let t = 0; t < seconds; t += dt) {
    channel.step(dt)
    peak = Math.max(peak, channel.x)
  }
  return { x: channel.x, v: channel.v, peak }
}

describe('PID torque on a unit-inertia joint (ζ ≈ Kd / 2√Kp)', () => {
  it('converges to the setpoint', () => {
    const { x } = run({ kp: 12, kd: 2.5 })
    expect(Math.abs(x - 1)).toBeLessThan(1e-3)
  })

  it('small Kd overshoots visibly; large Kd suppresses it — the course lesson', () => {
    const loose = run({ kp: 12, kd: 0.5 }) // ζ ≈ 0.07
    const tight = run({ kp: 12, kd: 6 }) // ζ ≈ 0.87
    expect(loose.peak).toBeGreaterThan(1.3)
    expect(tight.peak).toBeLessThan(1.05)
    expect(loose.peak).toBeGreaterThan(tight.peak)
  })

  it('respects hard joint stops and zeroes velocity on contact', () => {
    const channel = new PidChannel({
      x0: 0,
      pid: new PID({ kp: 30, ki: 5, kd: 0.2, outMin: -1000, outMax: 1000 }),
      max: 0.5,
    })
    channel.setpoint = 2 // unreachable, beyond the stop
    const dt = 1 / 240
    for (let t = 0; t < 4; t += dt) {
      channel.step(dt)
      expect(channel.x).toBeLessThanOrEqual(0.5 + 1e-9)
    }
    expect(channel.x).toBeCloseTo(0.5, 6)
  })
})
