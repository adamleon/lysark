import { describe, expect, it } from 'vitest'
import { MotionSystem, SpringChannel, type Channel } from './motion-system'
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
