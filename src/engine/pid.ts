export interface PidParams {
  kp: number
  ki?: number
  kd?: number
  outMin?: number
  outMax?: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * Textbook PID: τ = Kp·e + Ki·∫e·dt + Kd·ė (spec §5). Derivative is on the
 * error, so a setpoint step produces a real (clamped) derivative kick — that
 * is the behavior the course discusses, not an artifact to hide. Only the
 * very first step suppresses d, since ė is undefined without history.
 *
 * The integral is stored pre-weighted by Ki (iTerm = Σ Ki·e·dt): with Ki=0
 * nothing accumulates, so raising Ki live is bumpless instead of dumping the
 * session's dormant error history as torque. Anti-windup is conditional
 * integration — the integral does not grow while the output is saturated in
 * the direction of the error.
 */
export class PID {
  kp: number
  ki: number
  kd: number
  outMin: number
  outMax: number
  private iTerm = 0
  private ePrev: number | null = null

  constructor({ kp, ki = 0, kd = 0, outMin = -Infinity, outMax = Infinity }: PidParams) {
    this.kp = kp
    this.ki = ki
    this.kd = kd
    this.outMin = outMin
    this.outMax = outMax
  }

  step(measured: number, setpoint: number, dt: number): number {
    const e = setpoint - measured
    const d = this.ePrev === null ? 0 : (e - this.ePrev) / dt
    this.ePrev = e
    const iNext = this.iTerm + this.ki * e * dt
    const unclamped = this.kp * e + iNext + this.kd * d
    const out = clamp(unclamped, this.outMin, this.outMax)
    if (unclamped === out || unclamped > out !== e > 0) {
      this.iTerm = iNext
    }
    return out
  }

  /** hard stops and scene restores clear accumulated integral state */
  resetIntegral(): void {
    this.iTerm = 0
  }

  reset(): void {
    this.iTerm = 0
    this.ePrev = null
  }
}
