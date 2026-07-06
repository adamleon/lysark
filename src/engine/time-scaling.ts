/**
 * Time-scaling profiles s(t) for the trajectory-planning lecture (Baneplanlegging).
 *
 * A *path* is pure geometry q(s), s ∈ [0, 1]. A *trajectory* ("rute") adds timing:
 * a time scaling s(t): [0, T] → [0, 1] with s(0)=0, s(T)=1, that says WHERE along
 * the path we are at each instant. The pedagogical payload is the derivative
 * ladder — position s, velocity ṡ, acceleration s̈, jerk ⃛s — and which of them a
 * given profile leaves continuous:
 *
 *   cubic       — ṡ rests at both ends, but s̈ is NONZERO at the ends → a jerk
 *                 impulse at start/stop. "Geometrisk glatt, men ikke fysisk glatt."
 *   trapezoidal — constant-acceleration ramps + a cruise phase. s̈ is piecewise
 *                 constant (discontinuous), simplest to implement on real drives.
 *   s-curve     — seven bounded-jerk phases: the acceleration itself ramps up and
 *                 down (a trapezoid), so a(0)=a(T)=0 AND the jerk stays finite.
 *                 "Fysisk glatt, men med begrenset rykk."
 *   quintic     — ṡ AND s̈ both rest at the ends (a(0)=a(T)=0) → smooth jerk. The
 *                 smoothness win the whole lecture builds toward.
 *
 * Pure functions of (t, T); no engine or three.js dependency, so they're unit
 * tested directly (see time-scaling.test.ts) and reused by both the trajectory
 * channel (driving a joint/end-effector setpoint) and the curve widget (plotting
 * the profile). Values are the true polynomial derivatives at τ = clamp(t/T, 0, 1),
 * so the cubic's nonzero endpoint acceleration shows up in the plot as intended.
 */

/** path-parameter value and its 1st/2nd/3rd time derivatives at one instant */
export interface ProfileSample {
  /** s ∈ [0, 1] — fraction of the path traversed */
  s: number
  /** ṡ — path velocity (1/s) */
  v: number
  /** s̈ — path acceleration (1/s²) */
  a: number
  /** ⃛s — path jerk (1/s³) */
  j: number
}

/** a time scaling sampled at time t over total duration T */
export type TimeScaling = (t: number, T: number) => ProfileSample

const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u)

/** degenerate T ≤ 0: collapse to a step, everything at rest */
const stepAt = (t: number): ProfileSample => ({ s: t <= 0 ? 0 : 1, v: 0, a: 0, j: 0 })

/**
 * Cubic (3rd-order) time scaling: s = 3τ² − 2τ³, τ = t/T.
 * Rests in velocity at both ends, but a(0)=+6/T², a(T)=−6/T² — the jerk impulse.
 */
export const cubic: TimeScaling = (t, T) => {
  if (T <= 0) return stepAt(t)
  const u = clamp01(t / T)
  return {
    s: 3 * u * u - 2 * u * u * u,
    v: (6 * u - 6 * u * u) / T,
    a: (6 - 12 * u) / (T * T),
    j: -12 / (T * T * T),
  }
}

/**
 * Quintic (5th-order) time scaling: s = 10τ³ − 15τ⁴ + 6τ⁵, τ = t/T.
 * Rests in position, velocity AND acceleration at both ends → continuous, bounded
 * jerk. The physically-smooth counterpart to the cubic.
 */
export const quintic: TimeScaling = (t, T) => {
  if (T <= 0) return stepAt(t)
  const u = clamp01(t / T)
  const u2 = u * u
  const u3 = u2 * u
  const u4 = u3 * u
  const u5 = u4 * u
  return {
    s: 10 * u3 - 15 * u4 + 6 * u5,
    v: (30 * u2 - 60 * u3 + 30 * u4) / T,
    a: (60 * u - 180 * u2 + 120 * u3) / (T * T),
    j: (60 - 360 * u + 360 * u2) / (T * T * T),
  }
}

/**
 * Trapezoidal velocity profile with symmetric constant-acceleration ramps.
 * `accelFraction` α = t_accel / T ∈ (0, 0.5] sets how much of the move is spent
 * ramping (α = 0.5 collapses the cruise phase → a triangular profile). Cruise
 * velocity 1/(T(1−α)) and ramp acceleration 1/(α(1−α)T²) are fixed by requiring
 * ∫ṡ dt = 1. Jerk is impulsive at the two blend joints, so `j` is reported 0
 * within each phase (the discontinuity is the point).
 */
export function trapezoidal(accelFraction = 0.25): TimeScaling {
  const alpha = Math.min(Math.max(accelFraction, 1e-3), 0.5)
  return (t, T) => {
    if (T <= 0) return stepAt(t)
    const tc = Math.min(Math.max(t, 0), T)
    const ta = alpha * T
    const vmax = 1 / (T * (1 - alpha))
    const acc = vmax / ta
    if (tc < ta) {
      return { s: 0.5 * acc * tc * tc, v: acc * tc, a: acc, j: 0 }
    }
    if (tc <= T - ta) {
      return { s: 0.5 * acc * ta * ta + vmax * (tc - ta), v: vmax, a: 0, j: 0 }
    }
    const td = T - tc
    return { s: 1 - 0.5 * acc * td * td, v: acc * td, a: -acc, j: 0 }
  }
}

/**
 * S-curve (double-S) time scaling: seven phases of piecewise-constant jerk, so the
 * acceleration is itself a trapezoid — it ramps up from zero, holds, ramps back to
 * zero for the accel half, then mirrors for the decel half. Because a(0)=a(T)=0 AND
 * the jerk is finite everywhere (never impulsive), it is *physically* smooth like the
 * quintic, but built the bounded-jerk way real motion controllers implement it —
 * "fysisk glatt, men med begrenset rykk".
 *
 * Phases as fractions of the total time T (symmetric):
 *   1  jerk +J   a: 0 → +A            (fj)
 *   2  jerk  0   a: +A (const accel)  (fa)
 *   3  jerk −J   a: +A → 0, ṡ = ṡ_max (fj)
 *   4  jerk  0   a: 0  (cruise)       (fv)
 *   5  jerk −J   a: 0 → −A            (fj)
 *   6  jerk  0   a: −A (const decel)  (fa)
 *   7  jerk +J   a: −A → 0            (fj)
 * with 4·fj + 2·fa + fv = 1. `jerkFraction` = fj, `accelFraction` = fa, the cruise
 * fills the remainder. The unit-jerk shape is integrated analytically once and scaled
 * by k = 1/s_shape(1) so s(0)=0, s(T)=1; ṡ, s̈, ⃛s then divide by T, T², T³.
 */
export function sCurve(jerkFraction = 0.1, accelFraction = 0.1): TimeScaling {
  const fj = Math.min(Math.max(jerkFraction, 1e-3), 0.25)
  const fa = Math.min(Math.max(accelFraction, 0), 0.5 - 2 * fj)
  const fv = 1 - 4 * fj - 2 * fa
  // [duration in τ, unit-jerk sign] for the seven phases
  const phases: Array<[number, number]> = [
    [fj, 1],
    [fa, 0],
    [fj, -1],
    [fv, 0],
    [fj, -1],
    [fa, 0],
    [fj, 1],
  ]
  // precompute the state (a, v, p) at the start of each phase for the unit-jerk shape
  interface Seg { t0: number; d: number; j: number; a0: number; v0: number; p0: number }
  const segs: Seg[] = []
  let t0 = 0
  let a0 = 0
  let v0 = 0
  let p0 = 0
  for (const [d, j] of phases) {
    segs.push({ t0, d, j, a0, v0, p0 })
    p0 += v0 * d + 0.5 * a0 * d * d + (j * d * d * d) / 6
    v0 += a0 * d + 0.5 * j * d * d
    a0 += j * d
    t0 += d
  }
  const k = p0 > 0 ? 1 / p0 : 1 // p0 is now s_shape(1); normalize to land on 1
  return (t, T) => {
    if (T <= 0) return stepAt(t)
    const tau = clamp01(t / T)
    let seg = segs[segs.length - 1] // τ = 1 belongs to the final phase
    for (const s of segs) {
      if (tau >= s.t0 && tau <= s.t0 + s.d) {
        seg = s
        break
      }
    }
    const l = tau - seg.t0
    const a = seg.a0 + seg.j * l
    const v = seg.v0 + seg.a0 * l + 0.5 * seg.j * l * l
    const p = seg.p0 + seg.v0 * l + 0.5 * seg.a0 * l * l + (seg.j * l * l * l) / 6
    return { s: k * p, v: (k * v) / T, a: (k * a) / (T * T), j: (k * seg.j) / (T * T * T) }
  }
}

/** the profiles addressable by name from slide frontmatter (trajectory + curve widget) */
export type ProfileName = 'cubic' | 'quintic' | 'trapezoidal' | 'scurve'

export const PROFILES: Record<ProfileName, TimeScaling> = {
  cubic,
  quintic,
  trapezoidal: trapezoidal(),
  scurve: sCurve(),
}
