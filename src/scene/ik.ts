import * as THREE from 'three'

/**
 * Numeric position-only inverse kinematics for the Lin/MoveL demo (spec: task-
 * space straight line), and for dragging the tool in the editor (step 5c of
 * docs/scene-files-proposal.md). Damped least squares over a geometric Jacobian:
 *
 *   Δq = Jᵀ (J Jᵀ + λ²I)⁻¹ e,   e = target − p_ee
 *
 * Position-only (3 constraints, 6 joints) is underdetermined; the damping term
 * makes J Jᵀ + λ²I always invertible (no singularity blow-ups) and picks a
 * least-norm joint step. Warm-started from the current pose each call, so along
 * a slowly-moving target it tracks smoothly in one configuration branch. The
 * robot mutates in place; `solve` returns the resulting joint values.
 */

interface UrdfJoint extends THREE.Object3D {
  axis: THREE.Vector3
  angle: number | string
  limit: { lower: number | string; upper: number | string }
}
interface UrdfRobot extends THREE.Object3D {
  joints: Record<string, UrdfJoint>
  links: Record<string, THREE.Object3D>
  setJointValue(name: string, value: number): unknown
}

export interface IkOptions {
  iterations?: number
  /** damping λ (rad·m). Larger = steadier but slower to reach the target. */
  damping?: number
  /** stop early once the end-effector is within this of the target (m) */
  tolerance?: number
  /** clamp on |Δq| per joint per iteration (rad) to keep steps sane */
  stepClamp?: number
  /** narrower limits for some joints, this solve only (rad): the editor keeps the elbow bent the way it is */
  limits?: Record<string, [number, number]>
  /**
   * a joint at its stop (or at a bound of `limits`) that a step would push
   * further steps aside, and the others are solved without it, so they still
   * take the tool on; off for MoveL, which never runs into a stop
   */
  stopsAside?: boolean
  /**
   * a pose the spare joints lean back toward, where that doesn't move the
   * tool (the null space): the editor's drag keeps the wrist as it was
   */
  rest?: Record<string, number>
  /** how strongly, per iteration (0 to 1) */
  restGain?: number
}

/**
 * The robot's elbow, for keeping it bent the way it is (the editor's tool
 * drag, step 5c): the elbow joint, the joint before it (the shoulder) and the
 * joint or link after it (the wrist: the KUKA's wrist centre, joint_5). The
 * elbow is straight where the wrist is farthest from the shoulder, measured
 * with the joints between the elbow and the wrist at zero.
 */
export interface ElbowSpec {
  joint: string
  shoulder: string
  wrist: string
}

export interface IkSolver {
  /** the elbow joint and its angle when the arm is stretched straight (rad), if the scene named one */
  elbow?: { joint: string; straight: number }
  /** world position of the end-effector at the current joint values */
  eePosition(): THREE.Vector3
  /** end-effector world position for a given joint set, leaving the robot as it was */
  fk(joints: Record<string, number>): THREE.Vector3
  /** drive the end-effector toward `target` (world), warm-started; returns the joints */
  solve(target: THREE.Vector3, opts?: IkOptions): Record<string, number>
  /** current joint values */
  getJoints(): Record<string, number>
  /** set joint values (no restore) — e.g. to warm-start a sampling sweep */
  setJoints(joints: Record<string, number>): void
}

export function createIkSolver(robot: UrdfRobot, jointNames: string[], eeName: string, elbowSpec?: ElbowSpec): IkSolver {
  const ee = robot.links[eeName]
  const joints = jointNames.map((n) => robot.joints[n])
  const elbow = elbowSpec ? { joint: elbowSpec.joint, straight: straightAngle(robot, elbowSpec) } : undefined

  const eePos = (): THREE.Vector3 => {
    robot.updateMatrixWorld(true)
    return ee.getWorldPosition(new THREE.Vector3())
  }

  const readJoints = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const name of jointNames) out[name] = Number(robot.joints[name].angle)
    return out
  }

  return {
    ...(elbow ? { elbow } : {}),
    eePosition: eePos,

    getJoints: readJoints,

    setJoints(joints) {
      for (const [name, v] of Object.entries(joints)) {
        if (robot.joints[name]) robot.setJointValue(name, v)
      }
      robot.updateMatrixWorld(true)
    },

    fk(target) {
      const saved = readJoints()
      for (const [name, v] of Object.entries(target)) {
        if (robot.joints[name]) robot.setJointValue(name, v)
      }
      const p = eePos()
      for (const name of jointNames) robot.setJointValue(name, saved[name])
      robot.updateMatrixWorld(true)
      return p
    },

    solve(target, opts = {}) {
      const iterations = opts.iterations ?? 8
      const lambda2 = (opts.damping ?? 0.08) ** 2
      const tol = opts.tolerance ?? 0.002
      const stepClamp = opts.stepClamp ?? 0.35

      const eeWorld = new THREE.Vector3()
      const pj = new THREE.Vector3()
      const err = new THREE.Vector3()
      const axis = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      const cols = joints.map(() => new THREE.Vector3())

      for (let it = 0; it < iterations; it++) {
        robot.updateMatrixWorld(true)
        ee.getWorldPosition(eeWorld)
        err.copy(target).sub(eeWorld)
        if (err.length() < tol) break

        // geometric Jacobian columns: ω_j × (p_ee − p_j)
        for (let j = 0; j < joints.length; j++) {
          const jo = joints[j]
          jo.getWorldPosition(pj)
          jo.getWorldQuaternion(quat)
          axis.copy(jo.axis).applyQuaternion(quat).normalize()
          cols[j].copy(eeWorld).sub(pj).crossVectors(axis, cols[j])
        }

        // the joints that take part: all, less (stopsAside) those at a stop, or at a bound of
        // opts.limits, that the step would push further
        const free = joints.map(() => true)
        const lower = joints.map((jo, j) => Math.max(Number(jo.limit.lower), opts.limits?.[jointNames[j]]?.[0] ?? -Infinity))
        const upper = joints.map((jo, j) => Math.min(Number(jo.limit.upper), opts.limits?.[jointNames[j]]?.[1] ?? Infinity))
        let minv = inverseOver(cols, free, lambda2)
        let y = err.clone().applyMatrix3(minv) // (J Jᵀ + λ²I)⁻¹ e
        for (let dropped = opts.stopsAside === true; dropped; ) {
          dropped = false
          for (let j = 0; j < joints.length; j++) {
            if (!free[j]) continue
            const q = Number(joints[j].angle)
            const dq = cols[j].dot(y)
            if ((q <= lower[j] + 1e-9 && dq < 0) || (q >= upper[j] - 1e-9 && dq > 0)) {
              free[j] = false
              dropped = true
            }
          }
          if (dropped) {
            minv = inverseOver(cols, free, lambda2)
            y = err.clone().applyMatrix3(minv)
          }
        }

        // the rest pose: z = gain (q_rest − q), less the part of it that would move the tool,
        // (I − Jᵀ(J Jᵀ + μ²I)⁻¹J) z, with a damping μ of its own, far below λ: with λ the
        // projection leaks, and the lean pulls the tool off its target near singular poses
        const lean = joints.map(() => 0)
        if (opts.rest) {
          const gain = opts.restGain ?? 0.1
          const z = joints.map((jo, j) => {
            const rest = opts.rest![jointNames[j]]
            return free[j] && rest !== undefined ? gain * (rest - Number(jo.angle)) : 0
          })
          const jz = new THREE.Vector3()
          for (let j = 0; j < joints.length; j++) if (free[j]) jz.addScaledVector(cols[j], z[j])
          const w = jz.applyMatrix3(inverseOver(cols, free, LEAN_DAMPING ** 2))
          for (let j = 0; j < joints.length; j++) if (free[j]) lean[j] = z[j] - cols[j].dot(w)
        }

        for (let j = 0; j < joints.length; j++) {
          if (!free[j]) continue
          const name = jointNames[j]
          const jo = robot.joints[name]
          let dq = cols[j].dot(y) + lean[j] // Δq_j = colⱼ · y, and the lean toward the rest pose
          dq = Math.max(-stepClamp, Math.min(stepClamp, dq))
          const bound = opts.limits?.[name]
          const lo = Math.max(Number(jo.limit.lower), bound ? bound[0] : -Infinity)
          const hi = Math.min(Number(jo.limit.upper), bound ? bound[1] : Infinity)
          robot.setJointValue(name, Math.max(lo, Math.min(hi, Number(jo.angle) + dq)))
        }
      }

      robot.updateMatrixWorld(true)
      return readJoints()
    },
  }
}

/**
 * The elbow's angle when the arm is stretched straight: where the wrist is
 * farthest from the shoulder, over the elbow's range (to a thousandth of a
 * radian). The robot is left as it was.
 */
function straightAngle(robot: UrdfRobot, spec: ElbowSpec): number {
  const elbow = robot.joints[spec.joint]
  const shoulder = robot.joints[spec.shoulder]
  const wrist = robot.joints[spec.wrist] ?? robot.links[spec.wrist]
  const saved = Number(elbow.angle)
  // the joints between the elbow and the wrist (the KUKA's joint_4), at zero while measuring
  const between: Array<[string, number]> = []
  for (let o: THREE.Object3D | null = wrist.parent; o && o !== elbow; o = o.parent) {
    const name = Object.keys(robot.joints).find((n) => robot.joints[n] === o)
    if (name) between.push([name, Number(robot.joints[name].angle)])
  }
  for (const [name] of between) robot.setJointValue(name, 0)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const reach = (q: number) => {
    robot.setJointValue(spec.joint, q)
    robot.updateMatrixWorld(true)
    return shoulder.getWorldPosition(a).distanceTo(wrist.getWorldPosition(b))
  }
  const lo = Number(elbow.limit.lower)
  const hi = Number(elbow.limit.upper)
  // across the range in hundredths, then in thousandths around the farthest
  let best = lo
  let far = -Infinity
  const sweep = (from: number, to: number, step: number) => {
    for (let q = Math.max(lo, from); q <= Math.min(hi, to) + 1e-12; q += step) {
      const d = reach(q)
      if (d > far) {
        far = d
        best = q
      }
    }
  }
  sweep(lo, hi, 0.01)
  sweep(best - 0.01, best + 0.01, 0.001)
  reach(saved)
  for (const [name, angle] of between) robot.setJointValue(name, angle)
  robot.updateMatrixWorld(true)
  return Number(best.toFixed(3)) || 0 // not -0
}

/** the damping of the rest pose's projection (rad·m), far below the step's own */
const LEAN_DAMPING = 0.01

/** (J Jᵀ + λ²I)⁻¹ over the joints that take part (symmetric 3×3) */
function inverseOver(cols: THREE.Vector3[], free: boolean[], lambda2: number): THREE.Matrix3 {
  let a00 = lambda2
  let a01 = 0
  let a02 = 0
  let a11 = lambda2
  let a12 = 0
  let a22 = lambda2
  cols.forEach((c, j) => {
    if (!free[j]) return
    a00 += c.x * c.x
    a01 += c.x * c.y
    a02 += c.x * c.z
    a11 += c.y * c.y
    a12 += c.y * c.z
    a22 += c.z * c.z
  })
  return new THREE.Matrix3().set(a00, a01, a02, a01, a11, a12, a02, a12, a22).invert()
}
