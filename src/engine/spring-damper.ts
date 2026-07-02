export interface SpringParams {
  /** natural frequency ω (rad/s) */
  omega?: number
  /** damping ratio ζ — 1 = critically damped */
  zeta?: number
}

/**
 * Second-order spring-damper channel (camera moves, UI micro-interactions).
 * Semi-implicit Euler; parameters are the ω/ζ the course teaches (spec §5).
 */
export class SpringDamper {
  omega: number
  zeta: number

  constructor({ omega = 8, zeta = 1 }: SpringParams = {}) {
    this.omega = omega
    this.zeta = zeta
  }

  step(x: number, target: number, v: number, dt: number): [number, number] {
    const a = this.omega * this.omega * (target - x) - 2 * this.zeta * this.omega * v
    v += a * dt
    x += v * dt
    return [x, v]
  }
}
