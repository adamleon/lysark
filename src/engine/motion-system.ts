import type { PID } from './pid'
import type { SpringDamper } from './spring-damper'

export interface Channel {
  /** advance one fixed timestep */
  step(dt: number): void
  /** signed distance to target, for settle detection */
  error(): number
  velocity(): number
}

export interface PidChannelOptions {
  x0: number
  pid: PID
  /** hard joint stops; velocity zeroes on contact */
  min?: number
  max?: number
  apply?: (x: number) => void
}

/**
 * PID torque on a unit-inertia joint: ẍ = τ, integrated twice (spec §5).
 * Gives the classic second-order response — ζ ≈ Kd / (2·√Kp), so small Kd
 * visibly overshoots and settles, which is the point of the lesson.
 */
export class PidChannel implements Channel {
  x: number
  v = 0
  setpoint: number
  readonly pid: PID
  private readonly min: number
  private readonly max: number
  private readonly apply?: (x: number) => void

  constructor({ x0, pid, min = -Infinity, max = Infinity, apply }: PidChannelOptions) {
    this.x = x0
    this.setpoint = x0
    this.pid = pid
    this.min = min
    this.max = max
    this.apply = apply
  }

  step(dt: number): void {
    const a = this.pid.step(this.x, this.setpoint, dt)
    this.v += a * dt
    this.x += this.v * dt
    // hard stops: kill velocity AND integral, or the controller grinds a
    // wound-up integral into the stop indefinitely
    if (this.x < this.min) {
      this.x = this.min
      this.v = 0
      this.pid.resetIntegral()
    } else if (this.x > this.max) {
      this.x = this.max
      this.v = 0
      this.pid.resetIntegral()
    }
    this.apply?.(this.x)
  }

  error(): number {
    return this.setpoint - this.x
  }

  velocity(): number {
    return this.v
  }
}

export interface SpringChannelOptions {
  x0: number
  spring: SpringDamper
  apply?: (x: number) => void
}

export class SpringChannel implements Channel {
  x: number
  v = 0
  target: number
  private readonly spring: SpringDamper
  private readonly apply?: (x: number) => void

  constructor({ x0, spring, apply }: SpringChannelOptions) {
    this.x = x0
    this.target = x0
    this.spring = spring
    this.apply = apply
  }

  /** snap to a value with no transient (idle sync, scene restore) */
  reset(x: number): void {
    this.x = x
    this.target = x
    this.v = 0
  }

  step(dt: number): void {
    ;[this.x, this.v] = this.spring.step(this.x, this.target, this.v, dt)
    this.apply?.(this.x)
  }

  error(): number {
    return this.target - this.x
  }

  velocity(): number {
    return this.v
  }
}

/**
 * Fixed-timestep integrator over all controlled scalars (spec §5).
 * Decoupled from rendering: whoever owns the frame loop calls step(elapsed).
 */
export class MotionSystem {
  static readonly DT = 1 / 240

  readonly channels = new Map<string, Channel>()
  epsError = 1e-3
  epsVelocity = 1e-2
  private accumulator = 0
  private settledTime = 0

  add<T extends Channel>(name: string, channel: T): T {
    this.channels.set(name, channel)
    return channel
  }

  remove(name: string): void {
    this.channels.delete(name)
  }

  step(elapsed: number): void {
    // clamp tab-switch gaps so we never spiral through thousands of substeps
    this.accumulator += Math.min(elapsed, 0.25)
    while (this.accumulator >= MotionSystem.DT) {
      for (const channel of this.channels.values()) channel.step(MotionSystem.DT)
      this.settledTime = this.allWithinEps() ? this.settledTime + MotionSystem.DT : 0
      this.accumulator -= MotionSystem.DT
    }
  }

  /** true once every channel has been at rest on target for holdSeconds */
  settled(holdSeconds = 0.15): boolean {
    return this.settledTime >= holdSeconds
  }

  private allWithinEps(): boolean {
    for (const channel of this.channels.values()) {
      if (
        Math.abs(channel.error()) > this.epsError ||
        Math.abs(channel.velocity()) > this.epsVelocity
      ) {
        return false
      }
    }
    return true
  }
}
