import { describe, expect, it } from 'vitest'
import { SpringDamper } from './spring-damper'

function simulate(zeta: number, seconds = 6, omega = 8) {
  const spring = new SpringDamper({ omega, zeta })
  let x = 0
  let v = 0
  let peak = 0
  const dt = 1 / 240
  for (let t = 0; t < seconds; t += dt) {
    ;[x, v] = spring.step(x, 1, v, dt)
    peak = Math.max(peak, x)
  }
  return { x, v, peak }
}

describe('SpringDamper', () => {
  it('critically damped (ζ=1) converges without overshoot', () => {
    const { x, peak } = simulate(1)
    expect(Math.abs(x - 1)).toBeLessThan(1e-4)
    expect(peak).toBeLessThanOrEqual(1 + 1e-6)
  })

  it('underdamped (ζ=0.3) overshoots, then converges', () => {
    const { x, peak } = simulate(0.3)
    expect(peak).toBeGreaterThan(1.2)
    expect(Math.abs(x - 1)).toBeLessThan(1e-3)
  })

  it('overdamped (ζ=2) never overshoots', () => {
    const { x, peak } = simulate(2, 10)
    expect(peak).toBeLessThanOrEqual(1 + 1e-6)
    expect(Math.abs(x - 1)).toBeLessThan(1e-2)
  })
})
