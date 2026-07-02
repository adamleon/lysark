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

  it('a session driven with Ki=0 does not lurch when Ki is raised live', () => {
    const pid = new PID({ kp: 12, ki: 0, kd: 2.5, outMin: -60, outMax: 60 })
    const channel = new PidChannel({ x0: 0, pid, min: -2.4, max: 2.4 })
    const dt = 1 / 240
    for (const sp of [1.5, -1.0, 0.5, 2.0]) {
      channel.setpoint = sp
      for (let t = 0; t < 8; t += dt) channel.step(dt)
    }
    expect(Math.abs(channel.x - 2.0)).toBeLessThan(1e-3) // at rest on target
    pid.ki = 20 // the "now add some Ki" lesson beat
    let maxDeviation = 0
    for (let t = 0; t < 2; t += dt) {
      channel.step(dt)
      maxDeviation = Math.max(maxDeviation, Math.abs(channel.x - 2.0))
    }
    // pre-fix, dormant integral history lurched the joint 0.4 rad into its stop
    expect(maxDeviation).toBeLessThan(5e-3)
  })

  it('recovers cleanly after saturating against a stop (anti-windup)', () => {
    const pid = new PID({ kp: 40, ki: 20, kd: 2.5, outMin: -60, outMax: 60 })
    const channel = new PidChannel({ x0: -1.9, pid, min: -1.9, max: 1.9 })
    const dt = 1 / 240
    channel.setpoint = 1.9 // full-range slam into the stop
    for (let t = 0; t < 10; t += dt) channel.step(dt)
    expect(channel.x).toBeCloseTo(1.9, 3)
    channel.setpoint = 0 // the return move must not carry hidden integral
    for (let t = 0; t < 10; t += dt) channel.step(dt)
    expect(Math.abs(channel.x)).toBeLessThan(1e-2)
  })
})
