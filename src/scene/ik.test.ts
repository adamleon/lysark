import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createIkSolver } from './ik'
import { armChain } from './ik-test-chain'

const start = { joint1: 0, joint2: 0.6, joint3: -1.0, joint4: 0.3 }
const solver = () => createIkSolver(armChain('roll'), ['joint1', 'joint2', 'joint3', 'joint4'], 'tool')

describe('position inverse kinematics', () => {
  it('brings the tool to a point it can reach, the joints within their limits', () => {
    const ik = solver()
    ik.setJoints(start)
    const target = ik.fk({ joint1: 0.5, joint2: 0.3, joint3: -0.9, joint4: 0.3 })
    for (let k = 0; k < 3 && ik.eePosition().distanceTo(target) > 0.002; k++) ik.solve(target, { iterations: 12 })
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(0.002)
    const limits = { joint1: 3.1416, joint2: 1.9, joint3: 2.4, joint4: 2.4 }
    for (const [name, q] of Object.entries(ik.getJoints())) expect(Math.abs(q)).toBeLessThanOrEqual(limits[name as keyof typeof limits])
  })

  it("doesn't turn a joint whose axis runs through the tool", () => {
    const ik = solver()
    ik.setJoints(start)
    const solution = ik.solve(ik.fk({ joint1: 0.2, joint2: 0.4, joint3: -0.7, joint4: 0.3 }), { iterations: 12 })
    expect(Math.abs(solution.joint4 - start.joint4)).toBeLessThan(1e-6)
  })

  it('stays finite and within the limits for a point out of reach, and fk leaves the robot as it was', () => {
    const ik = solver()
    ik.setJoints(start)
    const solution = ik.solve(new THREE.Vector3(3, 2, 1), { iterations: 12 })
    for (const q of Object.values(solution)) {
      expect(Number.isFinite(q)).toBe(true)
      expect(Math.abs(q)).toBeLessThanOrEqual(3.1416)
    }
    const at = ik.eePosition()
    ik.fk(start)
    expect(ik.eePosition().distanceTo(at)).toBeLessThan(1e-9)
  })
})
