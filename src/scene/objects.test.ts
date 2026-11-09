import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../engine/object-types'
import { addObjects, buildObject } from './objects'

/** a colour per token, so a test can see which token each part took */
const TOKENS: Record<string, string> = {
  '--object-grey': '#808080',
  '--object-wood': '#a07040',
  '--frame-x': '#ff0000',
  '--frame-y': '#00ff00',
  '--frame-z': '#0000ff',
}
const color = (token: string) => {
  if (!TOKENS[token]) throw new Error(`no token ${token}`)
  return TOKENS[token]
}
const object = (spec: Partial<SceneObject> & Pick<SceneObject, 'name' | 'shape' | 'size'>): SceneObject => ({ at: [0, 0, 0], rotate: [0, 0, 0], ...spec })
const world = (node: THREE.Object3D) => {
  node.updateWorldMatrix(true, true)
  return node.getWorldPosition(new THREE.Vector3())
}
const near = (a: THREE.Vector3, b: [number, number, number]) => expect(a.distanceTo(new THREE.Vector3(...b))).toBeLessThan(1e-9)

describe('objects', () => {
  it('stands a shape on its origin, the middle of its underside', () => {
    const box = buildObject(object({ name: 'b', shape: 'box', size: [0.4, 0.2, 0.6], at: [1, 0, 2], material: 'wood' }), color)
    near(box.position, [1, 0, 2])
    const mesh = box.children[0] as THREE.Mesh
    expect(mesh.position.y).toBeCloseTo(0.1)
    expect((mesh.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 0.4, height: 0.2, depth: 0.6 })
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color('#a07040').getHexString())
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true)

    const cylinder = buildObject(object({ name: 'c', shape: 'cylinder', size: [0.1, 0.5], material: 'grey' }), color).children[0] as THREE.Mesh
    expect((cylinder.geometry as THREE.CylinderGeometry).parameters).toMatchObject({ radiusTop: 0.05, radiusBottom: 0.05, height: 0.5 })
    expect(cylinder.position.y).toBeCloseTo(0.25)
    const sphere = buildObject(object({ name: 's', shape: 'sphere', size: [0.08] }), color).children[0] as THREE.Mesh
    expect((sphere.geometry as THREE.SphereGeometry).parameters.radius).toBeCloseTo(0.04)
    expect(sphere.position.y).toBeCloseTo(0.04)
  })

  it('turns an object about x, then y, then z, in degrees', () => {
    const node = buildObject(object({ name: 'r', shape: 'point', size: [], rotate: [0, 90, 0] }), color)
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(node.rotation.order).toBe('XYZ')
    // a box turned 90° about z lies on its side: its height runs along -x
    const lying = buildObject(object({ name: 'l', shape: 'box', size: [0.1, 1, 0.1], rotate: [0, 0, 90] }), color)
    near(world(lying.children[0]), [-0.5, 0, 0])
  })

  it('draws a frame as x, y and z arrows in the axis colours, and a point as nothing', () => {
    const frame = buildObject(object({ name: 'f', shape: 'frame', size: [0.2] }), color)
    expect(frame.children.map((axis) => axis.name)).toEqual(['axis:x', 'axis:y', 'axis:z'])
    for (const [k, hex] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
      const axis = frame.children[k]
      const tip = axis.children[1] as THREE.Mesh
      expect((tip.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(new THREE.Color(hex).getHexString())
      // the tip of each arrow ends at the axis length along its own axis
      const end = new THREE.Vector3(0, 0.2, 0).applyEuler(axis.rotation)
      const unit = [0, 0, 0] as [number, number, number]
      unit[k] = 0.2
      near(end, unit)
      expect(tip.castShadow).toBe(false)
    }
    expect(buildObject(object({ name: 'p', shape: 'point', size: [] }), color).children).toHaveLength(0)
  })

  it('adds objects on their parents, each an anchor of the scene by its name', () => {
    const root = new THREE.Group()
    const tool = new THREE.Group()
    tool.position.set(0, 1, 0)
    tool.rotation.x = -Math.PI / 2 // a robot link's frame: its z points up
    root.add(tool)
    const scene = { root, anchors: { tool0: tool } as Record<string, THREE.Object3D> }
    addObjects(
      scene,
      [
        object({ name: 'table', shape: 'box', size: [0.4, 0.2, 0.4], at: [1, 0, 0] }),
        object({ name: 'top', shape: 'point', size: [], at: [0, 0.2, 0], parent: 'table' }),
        object({ name: 'tip', shape: 'point', size: [], at: [0, 0, 0.1], parent: 'tool0' }),
      ],
      color,
    )
    expect(Object.keys(scene.anchors)).toEqual(['tool0', 'table', 'top', 'tip'])
    expect(scene.anchors.table.parent).toBe(root)
    near(world(scene.anchors.top), [1, 0.2, 0])
    // 0.1 along the link's z, which points up
    near(world(scene.anchors.tip), [0, 1.1, 0])
    expect(() => addObjects(scene, [object({ name: 'tool0', shape: 'point', size: [] })], color)).toThrow(/has an anchor of that name/)
    expect(() => addObjects(scene, [object({ name: 'x', shape: 'point', size: [], parent: 'nowhere' })], color)).toThrow(/isn't in the scene/)
    // the anchors are a plain object: what it inherits is neither an anchor nor a name to take
    expect(() => addObjects(scene, [object({ name: 'x', shape: 'point', size: [], parent: 'constructor' })], color)).toThrow(/isn't in the scene/)
    expect(() => addObjects(scene, [object({ name: '__proto__', shape: 'point', size: [] })], color)).toThrow(/a name JavaScript keeps for itself/)
    expect(Object.getPrototypeOf(scene.anchors)).toBe(Object.prototype)
  })

  it("builds a shape along its parent's y, and rotate [90, 0, 0] turns it onto a robot anchor's z", () => {
    const root = new THREE.Group()
    const base = new THREE.Group()
    base.rotation.x = -Math.PI / 2 // a robot's base: its z points up, its y along the floor
    root.add(base)
    const scene = { root, anchors: { base } as Record<string, THREE.Object3D> }
    addObjects(
      scene,
      [
        object({ name: 'flat', shape: 'cylinder', size: [0.1, 0.4], parent: 'base' }),
        object({ name: 'upright', shape: 'cylinder', size: [0.1, 0.4], parent: 'base', rotate: [90, 0, 0] }),
      ],
      color,
    )
    near(world(scene.anchors.flat.children[0]), [0, 0, -0.2])
    near(world(scene.anchors.upright.children[0]), [0, 0.2, 0])
  })

  it('turns as docs/scene-files.md says', () => {
    const root = new THREE.Group()
    const base = new THREE.Group()
    base.rotation.x = -Math.PI / 2
    root.add(base)
    const scene = { root, anchors: { base } as Record<string, THREE.Object3D> }
    const cylinder = (name: string, rotate: [number, number, number], parent?: string) =>
      object({ name, shape: 'cylinder', size: [0.1, 1], rotate, ...(parent ? { parent } : {}) })
    addObjects(scene, [cylinder('along z', [90, 0, 0]), cylinder('along x, 30', [0, 30, 90]), cylinder('base, 30', [90, 30, 0], 'base')], color)
    const c30 = Math.cos(Math.PI / 6) / 2
    // the middle of a cylinder 1 long: half its height along where it points
    near(world(scene.anchors['along z'].children[0]), [0, 0, 0.5])
    near(world(scene.anchors['along x, 30'].children[0]), [-c30, 0, 0.25])
    // on a robot's base (z up): standing, turned 30 degrees about the vertical
    near(world(scene.anchors['base, 30'].children[0]), [0, 0.5, 0])
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(scene.anchors['base, 30'].getWorldQuaternion(new THREE.Quaternion()))
    near(x, [c30 * 2, 0, -0.5])
  })
})
