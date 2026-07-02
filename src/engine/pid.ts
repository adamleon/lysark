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
 */
export class PID {
  kp: number
  ki: number
  kd: number
  outMin: number
  outMax: number
  private i = 0
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
    this.i += e * dt
    const d = this.ePrev === null ? 0 : (e - this.ePrev) / dt
    this.ePrev = e
    return clamp(this.kp * e + this.ki * this.i + this.kd * d, this.outMin, this.outMax)
  }

  reset(): void {
    this.i = 0
    this.ePrev = null
  }
}
