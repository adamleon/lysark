import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../engine/object-types'
import { binaryStl, box, glb } from './model-test-files.js'
import { parseModel } from './models'
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
/** a model object showing models/part.stl */
const modelSpec = (spec: Partial<SceneObject> & Pick<SceneObject, 'name'>, unit: 'mm' | 'cm' | 'm' = 'm', up: 'y' | 'z' = 'y'): SceneObject =>
  object({ shape: 'model', size: [], model: { src: 'models/part.stl', unit, up }, ...spec })
/** the world box of everything under the node, as the scene shows it */
const worldBox = (node: THREE.Object3D) => {
  node.updateWorldMatrix(true, true)
  return new THREE.Box3().setFromObject(node, true)
}
const nearly = (a: THREE.Vector3, b: [number, number, number]) => expect(a.distanceTo(new THREE.Vector3(...b))).toBeLessThan(1e-6)
const meshesUnder = (node: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  node.traverse((part) => {
    if ((part as THREE.Mesh).isMesh) out.push(part as THREE.Mesh)
  })
  return out
}

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

  it('gives every object its middle: how high above at, before rotate (the editor ring sits there)', () => {
    const middle = (spec: SceneObject) => buildObject(spec, color).userData.middle
    expect(middle(object({ name: 'b', shape: 'box', size: [0.4, 0.2, 0.6], rotate: [0, 0, 90] }))).toBeCloseTo(0.1)
    expect(middle(object({ name: 'c', shape: 'cylinder', size: [0.1, 0.5] }))).toBeCloseTo(0.25)
    expect(middle(object({ name: 's', shape: 'sphere', size: [0.08] }))).toBeCloseTo(0.04)
    expect(middle(object({ name: 'f', shape: 'frame', size: [0.2] }))).toBe(0)
    expect(middle(object({ name: 'p', shape: 'point', size: [] }))).toBe(0)
    // a model object without its model (the file was refused): an empty node, still an anchor and a parent
    const empty = buildObject(modelSpec({ name: 'm' }), color)
    expect(empty.children).toHaveLength(0)
    expect(empty.userData.middle).toBe(0)
  })

  it("stands a model's underside on at, measured after unit and up and before rotate", async () => {
    // 100 x 50 x 20 mm, drawn z up with its origin at a corner, as a CAD program writes it
    const part = () => parseModel(binaryStl(box([0, 0, 0], [100, 50, 20])), 'stl')
    const bracket = buildObject(modelSpec({ name: 'bracket', at: [1, 0.5, 2] }, 'mm', 'z'), color, await part())
    // the file's z is up, its y runs along -z, and the middle of the underside is at `at`
    nearly(worldBox(bracket).min, [0.95, 0.5, 1.975])
    nearly(worldBox(bracket).max, [1.05, 0.52, 2.025])
    expect(bracket.userData.middle).toBeCloseTo(0.01)
    // rotate turns it about at, and leaves its middle as it was
    const turned = buildObject(modelSpec({ name: 'turned', rotate: [0, 0, 90] }, 'mm', 'z'), color, await part())
    nearly(worldBox(turned).min, [-0.02, -0.05, -0.025])
    nearly(worldBox(turned).max, [0, 0.05, 0.025])
    expect(turned.userData.middle).toBeCloseTo(0.01)
    // the same numbers in centimetres, y up
    const tray = buildObject(modelSpec({ name: 'tray' }, 'cm'), color, await parseModel(binaryStl(box([0, 0, 0], [10, 4, 2])), 'stl'))
    nearly(worldBox(tray).min, [-0.05, 0, -0.01])
    nearly(worldBox(tray).max, [0.05, 0.04, 0.01])
    expect(tray.userData.middle).toBeCloseTo(0.02)
  })

  it("gives every mesh of a model the object's one preset, casting and taking shadows", async () => {
    const tray = buildObject(modelSpec({ name: 'tray', material: 'wood' }), color, await parseModel(glb({ meshes: [{}, { translation: [2, 0, 0] }] }), 'glb'))
    const parts = meshesUnder(tray)
    expect(parts).toHaveLength(2)
    expect(parts[1].material).toBe(parts[0].material)
    expect((parts[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color('#a07040').getHexString())
    expect(parts.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true)
    const plain = meshesUnder(buildObject(modelSpec({ name: 'plain' }), color, await parseModel(binaryStl(), 'stl')))[0]
    expect((plain.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color('#808080').getHexString())
  })

  it("hangs objects on a model's node, where they don't count in its box", async () => {
    const scene = { root: new THREE.Group(), anchors: {} as Record<string, THREE.Object3D> }
    addObjects(
      scene,
      [modelSpec({ name: 'tray', at: [1, 0, 0] }), object({ name: 'cup', shape: 'cylinder', size: [0.08, 0.3], at: [0, 0.1, 0], parent: 'tray' })],
      color,
      new Map([['tray', await parseModel(binaryStl(box([0, 0, 0], [0.4, 0.1, 0.3])), 'stl')]]),
    )
    expect(scene.anchors.cup.parent).toBe(scene.anchors.tray)
    expect(scene.anchors.tray.userData.middle).toBeCloseTo(0.05)
    nearly(worldBox(scene.anchors.tray.children[0]).min, [0.8, 0, -0.15])
    near(world(scene.anchors.cup), [1, 0.1, 0])
  })

  it("turns a z-up file onto a robot anchor's axes with up: z and rotate [90, 0, 0]", async () => {
    const root = new THREE.Group()
    const base = new THREE.Group()
    base.rotation.x = -Math.PI / 2 // a robot's base: its z points up
    root.add(base)
    const scene = { root, anchors: { base } as Record<string, THREE.Object3D> }
    // a gripper 20 mm across and 60 mm long, along the file's z
    const gripper = await parseModel(binaryStl(box([-10, -10, 0], [10, 10, 60])), 'stl')
    addObjects(scene, [modelSpec({ name: 'gripper', parent: 'base', rotate: [90, 0, 0] }, 'mm', 'z')], color, new Map([['gripper', gripper]]))
    root.updateWorldMatrix(true, true)
    // the file's x, y and z are the anchor's
    expect(gripper.getWorldQuaternion(new THREE.Quaternion()).angleTo(base.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-7)
    // so it stands along the anchor's z, which points up
    nearly(worldBox(scene.anchors.gripper).min, [-0.01, 0, -0.01])
    nearly(worldBox(scene.anchors.gripper).max, [0.01, 0.06, 0.01])
  })
})
