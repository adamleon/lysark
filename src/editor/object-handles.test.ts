import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { heading, movedAt, toCentimetre, toDegree, turnedRotate } from './object-handles'

type Vec3 = [number, number, number]
const rad = THREE.MathUtils.degToRad
const quat = (r: Vec3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(r[0]), rad(r[1]), rad(r[2]), 'XYZ'))
/** a robot's base: its z points up */
const BASE = quat([-90, 0, 0])

describe('moving an object', () => {
  it('writes the coordinates a move changed to the centimetre, the others as they were', () => {
    const root = new THREE.Matrix4()
    expect(movedAt(root, [0.625, 0, -0.69], new THREE.Vector3(0.7012, 0, -0.5049))).toEqual([0.7, 0, -0.5])
    // up and down only: x and z stay as written, three decimals and all
    expect(movedAt(root, [0.625, 0.1, -0.691], new THREE.Vector3(0.625, 0.2549, -0.691))).toEqual([0.625, 0.25, -0.691])
    expect(toCentimetre(-0.004)).toBe(0)
    expect(Object.is(toCentimetre(-0.004), -0)).toBe(false)
    expect(toDegree(-0.4)).toBe(0)
  })

  it("moves in its parent's frame: on a turned table, along the floor leaves its height", () => {
    const table = new THREE.Object3D()
    table.position.set(0.62, 0, -0.69)
    table.rotation.set(0, rad(48), 0)
    table.updateMatrixWorld()
    const from: Vec3 = [0, 0.3, 0]
    const world = new THREE.Vector3(...from).applyMatrix4(table.matrixWorld).add(new THREE.Vector3(0.1, 0, 0.05))
    const at = movedAt(table.matrixWorld, from, world)
    expect(at[1]).toBe(0.3)
    expect(Math.hypot(at[0], at[2])).toBeCloseTo(Math.hypot(0.1, 0.05), 2)
  })

  it('on a robot base (z up), along the floor is its x and y', () => {
    const base = new THREE.Object3D()
    base.quaternion.copy(BASE)
    base.updateMatrixWorld()
    // world x is the base's x; world -z is the base's y
    expect(movedAt(base.matrixWorld, [0, 0, 0.5], new THREE.Vector3(0.2, 0.5, -0.3))).toEqual([0.2, 0.3, 0.5])
  })
})

describe('turning an object about the vertical', () => {
  const id = new THREE.Quaternion()

  it('changes the angle about y of an object standing in the scene', () => {
    expect(turnedRotate(id, [0, 48, 0], 2)).toEqual([0, 50, 0])
    expect(turnedRotate(id, [0, 170, 0], 20)).toEqual([0, -170, 0])
    // past the straight up and down of y the other way of writing it is kept away from
    expect(turnedRotate(id, [0, 120, 0], 5)).toEqual([0, 125, 0])
    expect(turnedRotate(id, [0, -100, 0], -10)).toEqual([0, -110, 0])
    // laid along x (z 90), turned about the vertical: y changes, as docs/scene-files.md says
    expect(turnedRotate(id, [0, 30, 90], 10)).toEqual([0, 40, 90])
    expect(turnedRotate(id, [0, 48, 0], 0)).toEqual([0, 48, 0])
    // rounded, then wrapped: never -180
    expect(turnedRotate(id, [0, -178.6, 0], -1)).toEqual([0, 180, 0])
    expect(turnedRotate(id, [0, -170, 0], -10)).toEqual([0, 180, 0])
  })

  it('turns a cylinder laid along z about the vertical as its own z', () => {
    // Ry(30)·Rx(90) = Rx(90)·Rz(-30)
    expect(turnedRotate(id, [90, 0, 0], 30)).toEqual([90, 0, -30])
  })

  it("on a robot's base (z up), [90, a, 0] turns to [90, a + d, 0]", () => {
    expect(turnedRotate(BASE, [90, 30, 0], 5)).toEqual([90, 35, 0])
    expect(turnedRotate(BASE, [90, 0, 0], -15)).toEqual([90, -15, 0])
    // a frame on the base, as docs/scene-files.md says: the angle about z
    expect(turnedRotate(BASE, [0, 0, 0], 30)).toEqual([0, 0, 30])
  })

  it('turns any object as near the exact turn as whole degrees allow', () => {
    for (const [from, parent, d] of [
      [[10, 0, 0], id, 90],
      [[20, 35, -50], quat([0, 30, 0]), -40],
      [[5, 80, 12], BASE, 33],
      [[-170, 10, 175], quat([12, -40, 7]), 120],
    ] as Array<[Vec3, THREE.Quaternion, number]>) {
      const got = turnedRotate(parent, from, d)
      const exact = parent.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad(d))).multiply(parent).multiply(quat(from))
      expect(THREE.MathUtils.radToDeg(quat(got).angleTo(exact))).toBeLessThan(1.5)
      expect(got.every((v) => Number.isInteger(v) && v > -180 && v <= 180)).toBe(true)
    }
  })
})

describe("an object's heading", () => {
  it('is its x along the floor, or the flattest of its axes', () => {
    const node = new THREE.Object3D()
    node.rotation.set(0, rad(90), 0)
    node.updateMatrixWorld()
    const h = heading(node)
    expect(h.x).toBeCloseTo(0)
    expect(h.z).toBeCloseTo(-1)
    // its x tilted, but more along the floor than up: still its x
    node.rotation.set(0, 0, rad(40))
    node.updateMatrixWorld()
    expect(heading(node).x).toBeCloseTo(1)
    // its x straight up: the flatter of its z and y
    node.rotation.set(0, 0, rad(90))
    node.updateMatrixWorld()
    expect(heading(node).z).toBeCloseTo(1)
  })

  it('keeps to one axis while the object turns, ties included', () => {
    const id = new THREE.Quaternion()
    for (const start of [[0, 30, 90], [0, 0, 45], [0, 30, 45]] as Vec3[]) {
      const axes = new Set<string>()
      for (let d = 0; d < 360; d += 10) {
        const node = new THREE.Object3D()
        const r = turnedRotate(id, start, d)
        node.rotation.set(rad(r[0]), rad(r[1]), rad(r[2]), 'XYZ')
        node.updateMatrixWorld()
        // which of the object's own axes the dot is along
        const h = heading(node)
        const q = node.getWorldQuaternion(new THREE.Quaternion())
        const along = (['x', 'y', 'z'] as const).find((a) => {
          const v = new THREE.Vector3(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0).applyQuaternion(q).setY(0)
          return v.length() > 1e-6 && v.normalize().distanceTo(h) < 1e-6
        })
        axes.add(along ?? '?')
      }
      expect([...axes]).toHaveLength(1)
    }
  })
})
