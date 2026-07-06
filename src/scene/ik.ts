import * as THREE from 'three'

/**
 * Numeric position-only inverse kinematics for the Lin/MoveL demo (spec: task-
 * space straight line). Damped least squares over a geometric Jacobian:
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
}

export interface IkSolver {
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

export function createIkSolver(robot: UrdfRobot, jointNames: string[], eeName: string): IkSolver {
  const ee = robot.links[eeName]
  const joints = jointNames.map((n) => robot.joints[n])

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

        // M = J Jᵀ + λ²I  (symmetric 3×3)
        let a00 = lambda2
        let a01 = 0
        let a02 = 0
        let a11 = lambda2
        let a12 = 0
        let a22 = lambda2
        for (const c of cols) {
          a00 += c.x * c.x
          a01 += c.x * c.y
          a02 += c.x * c.z
          a11 += c.y * c.y
          a12 += c.y * c.z
          a22 += c.z * c.z
        }
        const minv = new THREE.Matrix3().set(a00, a01, a02, a01, a11, a12, a02, a12, a22).invert()
        const y = err.clone().applyMatrix3(minv) // (J Jᵀ + λ²I)⁻¹ e

        for (let j = 0; j < joints.length; j++) {
          const name = jointNames[j]
          const jo = robot.joints[name]
          let dq = cols[j].dot(y) // Δq_j = colⱼ · y
          dq = Math.max(-stepClamp, Math.min(stepClamp, dq))
          const lo = Number(jo.limit.lower)
          const hi = Number(jo.limit.upper)
          robot.setJointValue(name, Math.max(lo, Math.min(hi, Number(jo.angle) + dq)))
        }
      }

      robot.updateMatrixWorld(true)
      return readJoints()
    },
  }
}
