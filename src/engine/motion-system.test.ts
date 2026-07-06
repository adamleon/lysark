import { describe, expect, it } from 'vitest'
import { MotionSystem, PidChannel, SpringChannel, type Channel } from './motion-system'
import { PID } from './pid'
import { SpringDamper } from './spring-damper'

class CountingChannel implements Channel {
  steps = 0
  step(): void {
    this.steps++
  }
  error(): number {
    return 0
  }
  velocity(): number {
    return 0
  }
}

describe('MotionSystem', () => {
  it('advances channels on a fixed timestep with an accumulator', () => {
    const motion = new MotionSystem()
    const counter = motion.add('c', new CountingChannel())
    motion.step(0.1)
    expect(counter.steps).toBe(Math.floor(0.1 / MotionSystem.DT))
    motion.step(0.1) // remainder carries over between calls
    expect(counter.steps).toBe(Math.floor(0.2 / MotionSystem.DT))
  })

  it('clamps huge elapsed gaps (tab switch) instead of spiraling', () => {
    const motion = new MotionSystem()
    const counter = motion.add('c', new CountingChannel())
    motion.step(60)
    expect(counter.steps).toBeLessThanOrEqual(Math.ceil(0.25 / MotionSystem.DT))
  })

  it('reports settled only after all channels rest on target for the hold time', () => {
    const motion = new MotionSystem()
    const channel = motion.add(
      'c',
      new SpringChannel({ x0: 0, spring: new SpringDamper({ omega: 8, zeta: 1 }) }),
    )
    channel.target = 1
    motion.step(0.05)
    expect(motion.settled()).toBe(false)
    for (let i = 0; i < 60; i++) motion.step(1 / 30) // 2 simulated seconds
    expect(motion.settled()).toBe(true)
    channel.target = 2 // new target un-settles on the next step
    motion.step(1 / 30)
    expect(motion.settled()).toBe(false)
  })
})

describe('PidChannel kinematic playback', () => {
  function make(x0 = 0) {
    const applied: number[] = []
    const ch = new PidChannel({
      x0,
      pid: new PID({ kp: 12, ki: 0, kd: 7 }),
      min: -2,
      max: 2,
      apply: (x) => applied.push(x),
    })
    return { ch, applied }
  }

  it('replays the exact commanded position/velocity, bypassing PID', () => {
    const { ch, applied } = make()
    ch.playback = { x: 0.73, v: 1.4 }
    ch.step(1 / 240)
    expect(ch.x).toBeCloseTo(0.73)
    expect(ch.v).toBeCloseTo(1.4)
    expect(applied.at(-1)).toBeCloseTo(0.73) // joint mesh updated
  })

  it('clamps playback to the joint limits', () => {
    const { ch } = make()
    ch.playback = { x: 5, v: 0 }
    ch.step(1 / 240)
    expect(ch.x).toBe(2) // max
  })

  it('reports error 0 while playing (settle rests on velocity)', () => {
    const { ch } = make()
    ch.setpoint = 1.5 // stale setpoint must not register as error under playback
    ch.playback = { x: 0.2, v: 0.9 }
    ch.step(1 / 240)
    expect(ch.error()).toBe(0)
    expect(ch.velocity()).toBeCloseTo(0.9)
  })

  it('resumes PID control when playback is cleared', () => {
    const { ch } = make()
    ch.playback = { x: 1, v: 0 }
    ch.step(1 / 240)
    ch.playback = null
    ch.setpoint = 1
    for (let i = 0; i < 2400; i++) ch.step(1 / 240) // 10 s to settle
    expect(ch.x).toBeCloseTo(1, 2)
    expect(ch.error()).toBeCloseTo(0, 2)
  })
})
