import { describe, expect, it } from 'vitest'
import { cubic, quintic, sCurve, trapezoidal } from './time-scaling'

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

describe('s-curve time scaling', () => {
  const prof = sCurve()

  it('maps endpoints 0→1 through the midpoint', () => {
    expect(prof(0, T).s).toBeCloseTo(0)
    expect(prof(T, T).s).toBeCloseTo(1)
    expect(prof(T / 2, T).s).toBeCloseTo(0.5)
  })

  it('rests in position, velocity AND acceleration at both ends', () => {
    expect(prof(0, T).v).toBeCloseTo(0)
    expect(prof(T, T).v).toBeCloseTo(0)
    expect(prof(0, T).a).toBeCloseTo(0)
    expect(prof(T, T).a).toBeCloseTo(0)
  })

  it('bounded-jerk win: a(0)=0 like the quintic, unlike the trapezoid’s step', () => {
    // the whole point of the S-curve — acceleration eases in from zero
    expect(Math.abs(prof(0, T).a)).toBeLessThan(1e-9)
    expect(Math.abs(trapezoidal(0.25)(0, T).a)).toBeGreaterThan(0.1)
  })

  it('is monotone and stays within [0,1]', () => {
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const s = prof((i / 200) * T, T).s
      expect(s).toBeGreaterThanOrEqual(-1e-9)
      expect(s).toBeLessThanOrEqual(1 + 1e-9)
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = s
    }
  })

  it('is symmetric about the midpoint', () => {
    for (const dt of [0.2, 0.5, 0.9]) {
      expect(prof(T / 2 - dt, T).s + prof(T / 2 + dt, T).s).toBeCloseTo(1)
    }
  })

  it('integrates to unit displacement (∫ṡ dt = 1)', () => {
    let area = 0
    const dt = 1 / 2000
    for (let t = 0; t < T; t += dt) area += prof(t, T).v * dt
    expect(area).toBeCloseTo(1, 2)
  })

  it('has a piecewise-constant, finite jerk (never the cubic’s impulse)', () => {
    // jerk is bounded everywhere — the physical distinction from cubic/trapezoid
    for (let i = 0; i <= 50; i++) {
      expect(Number.isFinite(prof((i / 50) * T, T).j)).toBe(true)
    }
  })

  it('clamps outside [0,T]', () => {
    expect(prof(-1, T).s).toBeCloseTo(0)
    expect(prof(T + 1, T).s).toBeCloseTo(1)
  })
})
