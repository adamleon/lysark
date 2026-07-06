import { describe, expect, it } from 'vitest'
import { cubic, quintic, trapezoidal } from './time-scaling'

const T = 2

describe('cubic time scaling', () => {
  it('maps endpoints 0→1 through the midpoint', () => {
    expect(cubic(0, T).s).toBeCloseTo(0)
    expect(cubic(T, T).s).toBeCloseTo(1)
    expect(cubic(T / 2, T).s).toBeCloseTo(0.5)
  })

  it('rests in velocity at both ends', () => {
    expect(cubic(0, T).v).toBeCloseTo(0)
    expect(cubic(T, T).v).toBeCloseTo(0)
  })

  it('has nonzero acceleration at the ends — the jerk impulse', () => {
    expect(cubic(0, T).a).toBeCloseTo(6 / (T * T))
    expect(cubic(T, T).a).toBeCloseTo(-6 / (T * T))
  })

  it('clamps outside [0,T]', () => {
    expect(cubic(-1, T).s).toBeCloseTo(0)
    expect(cubic(T + 1, T).s).toBeCloseTo(1)
  })
})

describe('quintic time scaling', () => {
  it('maps endpoints 0→1 through the midpoint', () => {
    expect(quintic(0, T).s).toBeCloseTo(0)
    expect(quintic(T, T).s).toBeCloseTo(1)
    expect(quintic(T / 2, T).s).toBeCloseTo(0.5)
  })

  it('rests in position, velocity AND acceleration at both ends', () => {
    expect(quintic(0, T).v).toBeCloseTo(0)
    expect(quintic(T, T).v).toBeCloseTo(0)
    expect(quintic(0, T).a).toBeCloseTo(0)
    expect(quintic(T, T).a).toBeCloseTo(0)
  })

  it('is the smoothness win over the cubic: a(0)=0 where the cubic jumps', () => {
    // guard the lecture's central claim so it can't silently regress
    expect(Math.abs(quintic(0, T).a)).toBeLessThan(1e-9)
    expect(Math.abs(cubic(0, T).a)).toBeGreaterThan(1)
  })
})

describe('trapezoidal time scaling', () => {
  const prof = trapezoidal(0.25)

  it('maps endpoints 0→1 and rests in velocity at both ends', () => {
    expect(prof(0, T).s).toBeCloseTo(0)
    expect(prof(T, T).s).toBeCloseTo(1)
    expect(prof(0, T).v).toBeCloseTo(0)
    expect(prof(T, T).v).toBeCloseTo(0)
  })

  it('cruises at constant velocity 1/(T(1−α)) with zero acceleration', () => {
    const mid = prof(T / 2, T)
    expect(mid.v).toBeCloseTo(1 / (T * (1 - 0.25)))
    expect(mid.a).toBeCloseTo(0)
  })

  it('is symmetric about the midpoint', () => {
    for (const dt of [0.1, 0.4, 0.7]) {
      expect(prof(T / 2 - dt, T).s + prof(T / 2 + dt, T).s).toBeCloseTo(1)
    }
  })

  it('integrates to unit displacement (∫ṡ dt = 1)', () => {
    let area = 0
    const dt = 1 / 2000
    for (let t = 0; t < T; t += dt) area += prof(t, T).v * dt
    expect(area).toBeCloseTo(1, 2)
  })

  it('triangular limit (α=0.5) still reaches the midpoint at half distance', () => {
    const tri = trapezoidal(0.5)
    expect(tri(T / 2, T).s).toBeCloseTo(0.5)
    expect(tri(T, T).s).toBeCloseTo(1)
  })
})
