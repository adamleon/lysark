import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createIkSolver } from '../scene/ik'
import { armChain } from '../scene/ik-test-chain'
import { stepToward } from './tool-handle'

const ELBOW = { joint: 'joint3', shoulder: 'joint2', wrist: 'tool' }
const arm = (joints: Record<string, number>) => {
  const ik = createIkSolver(armChain(), ['joint1', 'joint2', 'joint3'], 'tool', ELBOW)
  ik.setJoints(joints)
  return ik
}
/** a drag: the target moved along a line in `steps`, the tool stepped `frames` times at each */
const dragAlong = (ik: ReturnType<typeof arm>, from: THREE.Vector3, to: THREE.Vector3, steps = 6, frames = 4) => {
  for (let s = 1; s <= steps; s++) for (let k = 0; k < frames; k++) stepToward(ik, from.clone().lerp(to, s / steps))
}
/** the shoulder (joint2) in the chain: at the base's height, on its axis */
const SHOULDER = new THREE.Vector3(0, 0, 0.17)

describe('stepping the tool toward the pointer (stepToward)', () => {
  it("knows where the arm's elbow is straight", () => {
    expect(arm({ joint1: 0, joint2: 0, joint3: 0 }).elbow).toEqual({ joint: 'joint3', straight: 0 })
  })

  it('follows a drag that needs a large turn at the base', () => {
    const ik = arm({ joint1: -0.4, joint2: 0.5, joint3: -1.5 })
    const target = ik.fk({ joint1: -1.62, joint2: -0.05, joint3: -0.64 })
    dragAlong(ik, ik.eePosition(), target)
    for (let k = 0; k < 20; k++) stepToward(ik, target)
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(0.002)
  })

  it('bends an arm stretched straight to pull the tool in along it, which a plain solve can’t', () => {
    const ik = arm({ joint1: 0, joint2: 0.5, joint3: 0 })
    const target = SHOULDER.clone().lerp(ik.eePosition(), 0.85)
    for (let k = 0; k < 40; k++) stepToward(ik, target)
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(0.002)
  })

  it('goes most of the way toward a point far past reach, in one jump', () => {
    const ik = arm({ joint1: 0, joint2: 0.6, joint3: -1.0 })
    const target = ik.eePosition().add(new THREE.Vector3(0.5, 0, 0))
    const was = ik.eePosition().distanceTo(target)
    for (let k = 0; k < 10; k++) stepToward(ik, target)
    expect(was - ik.eePosition().distanceTo(target)).toBeGreaterThan(0.1)
  })

  it('slides along the edge of reach as the pointer moves, even far past it', () => {
    const ik = arm({ joint1: 0, joint2: 0.6, joint3: -1.0 })
    const out = ik.eePosition().add(new THREE.Vector3(2, 0, 0)) // far out: going sideways barely brings the tool nearer it
    dragAlong(ik, ik.eePosition(), out, 40, 3)
    const atEdge = ik.eePosition()
    dragAlong(ik, out, out.clone().add(new THREE.Vector3(0, 1.5, 0)), 40, 3)
    expect(ik.eePosition().y - atEdge.y).toBeGreaterThan(0.1)
  })

  it('keeps the elbow bent the way it was, out past reach and back, at any drag speed', () => {
    for (const dir of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 1)]) {
      for (const [steps, frames] of [
        [20, 3],
        [40, 3],
        [80, 1],
      ]) {
        const ik = arm({ joint1: 0, joint2: 0.6, joint3: -1.0 })
        const home = ik.eePosition()
        const far = home.clone().add(dir.clone().normalize().multiplyScalar(0.4)) // well past reach
        dragAlong(ik, home, far, steps, frames)
        expect(ik.getJoints().joint3).toBeLessThanOrEqual(-0.0299) // never nearer straight than the bend held
        dragAlong(ik, far, home, steps, frames)
        for (let k = 0; k < 20; k++) stepToward(ik, home)
        expect(ik.getJoints().joint3).toBeLessThan(0)
        expect(ik.eePosition().distanceTo(home)).toBeLessThan(0.003)
      }
    }
  })

  it("doesn't let a slow, fine drag turn a spare joint a long way", () => {
    // a wrist hinge makes the arm redundant for where the tool is, as the KUKA's wrist does
    const ik = createIkSolver(armChain('pitch'), ['joint1', 'joint2', 'joint3', 'joint4'], 'tool', { ...ELBOW, wrist: 'joint4' })
    ik.setJoints({ joint1: 0, joint2: 0.6, joint3: -1.0, joint4: 0.4 })
    const home = ik.eePosition()
    // a 1 cm circle, in moves of about a millimetre, then home
    for (let k = 1; k <= 60; k++) {
      const a = (k / 60) * 2 * Math.PI
      stepToward(ik, home.clone().add(new THREE.Vector3(0.01 * Math.sin(a), 0, 0.01 * (1 - Math.cos(a)))))
    }
    for (let k = 0; k < 5; k++) stepToward(ik, home)
    expect(Math.abs(ik.getJoints().joint4 - 0.4)).toBeLessThan(0.1)
  })

  // a wrist hinge makes the arm redundant for where the tool is, as the KUKA's wrist does
  const redundant = (joints: Record<string, number>) => {
    const ik = createIkSolver(armChain('pitch'), ['joint1', 'joint2', 'joint3', 'joint4'], 'tool', { ...ELBOW, wrist: 'joint4' })
    ik.setJoints(joints)
    return ik
  }

  it('pulls the tool in from an elbow held near straight, the wrist making up the rest', () => {
    const ik = redundant({ joint1: 0, joint2: 0.5, joint3: -0.03, joint4: 0.4 })
    const target = SHOULDER.clone().lerp(ik.eePosition(), 0.85)
    for (let k = 0; k < 40; k++) stepToward(ik, target)
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(0.002)
  })

  it("doesn't walk a spare joint while the pointer creeps a fraction of a millimetre at a time", () => {
    const ik = redundant({ joint1: 0, joint2: 0.6, joint3: -1.0, joint4: 0.4 })
    const home = ik.eePosition()
    for (let k = 1; k <= 100; k++) stepToward(ik, home.clone().add(new THREE.Vector3(0, 0, -0.0003 * k))) // 3 cm, 0.3 mm a time
    expect(Math.abs(ik.getJoints().joint4 - 0.4)).toBeLessThan(0.1)
  })

  it('comes back from a flick far out with the wrist as it was', () => {
    const ik = redundant({ joint1: 0, joint2: 0.6, joint3: -1.0, joint4: 0.4 })
    const home = ik.eePosition()
    const far = ik.fk({ joint1: 1.2, joint2: 0.2, joint3: -0.6, joint4: 0.4 })
    for (let k = 0; k < 40; k++) stepToward(ik, far) // the pointer there in one frame, the tool following
    for (let k = 0; k < 40; k++) stepToward(ik, home)
    expect(ik.eePosition().distanceTo(home)).toBeLessThan(0.002)
    expect(Math.abs(ik.getJoints().joint4 - 0.4)).toBeLessThan(0.15)
  })

  it('pulls a straight arm in along itself in one jump of a few centimetres', () => {
    const ik = arm({ joint1: 0.4, joint2: 0.3, joint3: 0 })
    const target = SHOULDER.clone().add(ik.eePosition().sub(SHOULDER).setLength(ik.eePosition().distanceTo(SHOULDER) - 0.035))
    const was = ik.eePosition().distanceTo(target)
    for (let k = 0; k < 30; k++) stepToward(ik, target)
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(was / 4)
  })

  it('goes on with the other joints where one has reached its stop', () => {
    const ik = arm({ joint1: 0, joint2: 1.7, joint3: -1.2 })
    const target = ik.fk({ joint1: 0, joint2: 1.9, joint3: -0.3 }) // joint2 at its stop, joint3 the rest
    for (let k = 0; k < 60; k++) stepToward(ik, target)
    expect(ik.eePosition().distanceTo(target)).toBeLessThan(0.002)
  })

  it('brings the spare joints back to the pose the drag began with, out past reach and back', () => {
    for (const dir of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
      const start = { joint1: 0, joint2: 0.6, joint3: -1.0, joint4: 0.4 }
      const ik = redundant(start)
      const home = ik.eePosition()
      const far = home.clone().add(dir.normalize().multiplyScalar(0.4))
      for (let s = 1; s <= 40; s++) for (let k = 0; k < 3; k++) stepToward(ik, home.clone().lerp(far, s / 40), start)
      for (let s = 39; s >= 0; s--) for (let k = 0; k < 3; k++) stepToward(ik, home.clone().lerp(far, s / 40), start)
      for (let k = 0; k < 20; k++) stepToward(ik, home, start)
      for (const [name, q] of Object.entries(ik.getJoints())) expect(Math.abs(q - start[name as keyof typeof start])).toBeLessThan(0.15)
    }
  })

  it('takes the tool on with the other joints at once where one is at its stop', () => {
    const ik = arm({ joint1: 0.3, joint2: 1.9, joint3: -1.0 })
    const target = ik.fk({ joint1: -0.4, joint2: 1.9, joint3: -0.3 })
    let steps = 0
    for (; steps < 40 && ik.eePosition().distanceTo(target) > 0.002; steps++) stepToward(ik, target)
    expect(steps).toBeLessThanOrEqual(18) // with the joint at its stop in the solve, it takes 24
  })

  it('takes no step, the robot as it was, toward a point it can get no nearer to', () => {
    const ik = arm({ joint1: 0, joint2: 0, joint3: 0 }) // straight up
    const before = ik.getJoints()
    expect(stepToward(ik, ik.eePosition().add(new THREE.Vector3(0, 0, 1)))).toBeNull() // straight above, past reach
    expect(ik.getJoints()).toEqual(before)
  })
})
