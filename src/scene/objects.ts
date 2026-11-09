import * as THREE from 'three'
import type { ObjectMaterial, SceneObject } from '../engine/object-types'
import type { SceneInstance } from '../engine/scene-types'
import { themeColor } from '../theme'

/** how each colour takes the scene's light; the colour itself is its token, `--object-<name>` */
const SURFACE: Record<ObjectMaterial, { roughness: number; metalness: number }> = {
  grey: { roughness: 0.7, metalness: 0 },
  white: { roughness: 0.6, metalness: 0 },
  black: { roughness: 0.6, metalness: 0 },
  red: { roughness: 0.55, metalness: 0 },
  yellow: { roughness: 0.55, metalness: 0 },
  green: { roughness: 0.55, metalness: 0 },
  blue: { roughness: 0.55, metalness: 0 },
  wood: { roughness: 0.85, metalness: 0 },
  metal: { roughness: 0.35, metalness: 0.6 },
}

/** a frame's axes: their thickness and arrowheads, as parts of the axis length */
const AXIS_RADIUS = 0.025
const HEAD_LENGTH = 0.2
const HEAD_RADIUS = 0.06
/** however short the axes, this thick (metres), so a small frame still shows */
const MIN_AXIS_RADIUS = 0.002

/**
 * Add a scene file's objects to a scene as it is first built
 * (docs/scene-files.md, "Objects"). Each goes on its parent (an object before
 * it in the list, or an anchor of the scene) or into the scene's root, and
 * becomes an anchor of the scene by its name, which slides look at and label.
 * `color` reads a colour token when the object is built (src/theme.ts).
 */
export function addObjects(
  scene: Pick<SceneInstance, 'root' | 'anchors'>,
  objects: SceneObject[],
  color: (token: string) => string = themeColor,
): void {
  for (const spec of objects) {
    // the compiler has checked both; this guards a deck built by other means
    // (own keys only: the anchors are a plain object, where 'constructor' and the like are taken)
    const parent = spec.parent === undefined ? scene.root : Object.hasOwn(scene.anchors, spec.parent) ? scene.anchors[spec.parent] : undefined
    if (!parent) throw new Error(`object '${spec.name}': its parent '${spec.parent}' isn't in the scene`)
    if (spec.name in Object.prototype) throw new Error(`object '${spec.name}': a name JavaScript keeps for itself`)
    if (Object.hasOwn(scene.anchors, spec.name)) throw new Error(`object '${spec.name}': the scene has an anchor of that name already`)
    const node = buildObject(spec, color)
    parent.add(node)
    scene.anchors[spec.name] = node
  }
}

/**
 * Put an object's node where `at` and `rotate` say, in its parent's frame:
 * `rotate` in degrees about x, then the turned y, then the turned z. The
 * editor moves objects with it too (src/editor/object-handles.ts).
 */
export function placeNode(node: THREE.Object3D, place: Pick<SceneObject, 'at' | 'rotate'>): void {
  node.position.set(...place.at)
  const [x, y, z] = place.rotate.map((degrees) => THREE.MathUtils.degToRad(degrees))
  node.rotation.set(x, y, z, 'XYZ')
}

/** the object, its origin at `at`: a shape stands on it, a frame's axes start there */
export function buildObject(spec: SceneObject, color: (token: string) => string = themeColor): THREE.Group {
  const node = new THREE.Group()
  node.name = `object:${spec.name}`
  placeNode(node, spec)
  if (spec.shape === 'frame') {
    node.add(...frameAxes(spec.size[0], color))
    return node
  }
  if (spec.shape === 'point') return node
  let geometry: THREE.BufferGeometry
  let height: number
  if (spec.shape === 'box') {
    const [width, h, depth] = spec.size
    geometry = new THREE.BoxGeometry(width, h, depth)
    height = h
  } else if (spec.shape === 'cylinder') {
    const [diameter, h] = spec.size
    geometry = new THREE.CylinderGeometry(diameter / 2, diameter / 2, h, 48)
    height = h
  } else {
    const [diameter] = spec.size
    geometry = new THREE.SphereGeometry(diameter / 2, 48, 24)
    height = diameter
  }
  const material = spec.material ?? 'grey'
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: color(`--object-${material}`), ...SURFACE[material] }),
  )
  mesh.name = `object:${spec.name}:${spec.shape}`
  // standing on its origin, the middle of its underside
  mesh.position.y = height / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  node.add(mesh)
  return node
}

/** x, y and z as arrows of `length`, in the axis colours; unlit, so each shows its token's colour */
function frameAxes(length: number, color: (token: string) => string): THREE.Group[] {
  const radius = Math.max(length * AXIS_RADIUS, MIN_AXIS_RADIUS)
  const head = Math.min(length * HEAD_LENGTH, length / 2)
  const shaft = length - head
  const axes: Array<[string, string, THREE.Euler]> = [
    ['x', '--frame-x', new THREE.Euler(0, 0, -Math.PI / 2)],
    ['y', '--frame-y', new THREE.Euler(0, 0, 0)],
    ['z', '--frame-z', new THREE.Euler(Math.PI / 2, 0, 0)],
  ]
  return axes.map(([axis, token, turn]) => {
    const material = new THREE.MeshBasicMaterial({ color: color(token) })
    // built along y, from the origin out, then turned onto its axis
    const line = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, shaft, 16), material)
    line.position.y = shaft / 2
    const tip = new THREE.Mesh(new THREE.ConeGeometry(Math.max(length * HEAD_RADIUS, radius * 2.4), head, 24), material)
    tip.position.y = shaft + head / 2
    const arrow = new THREE.Group()
    arrow.name = `axis:${axis}`
    arrow.add(line, tip)
    arrow.rotation.copy(turn)
    return arrow
  })
}
