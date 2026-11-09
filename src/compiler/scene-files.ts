import { isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node, type Pair } from 'yaml'
import type { CameraTargetSpec } from '../engine/slide-types'
import { OBJECT_MATERIALS, OBJECT_SHAPES, type ObjectMaterial, type ObjectShape, type SceneObject } from '../engine/object-types'
import { SCENE_ANCHORS } from '../scenes/anchors'
import { SCENE_JOINTS } from '../scenes/joints'
import { SCENE_NAMES } from '../scenes/registry'
import { closest } from './closest'

/**
 * A lecture's scene files (scene-files-proposal.md, docs/scene-files.md):
 * `scenes/<name>.yaml` next to slides.md, building on one of the engine's
 * scenes and adding named camera views, robot poses and objects. The compiler never reads files: the
 * caller passes their text in, keyed by path (`scenes/agilus.yaml`), and this
 * checks them, with the file and line in every error.
 */

/** a named view: a whole camera, the same from whichever slide flies to it */
export interface NamedView {
  camera: CameraTargetSpec
  /** where it is written, for errors */
  line: number
}

export interface SceneFile {
  /** as passed in, `scenes/agilus.yaml` */
  path: string
  /** the name slides use in `scene:`, the file name without extension */
  name: string
  /** the engine scene it builds on */
  base: string
  views: Map<string, NamedView>
  poses: Map<string, NamedPose>
  /** the objects it adds to its base scene, parents before the objects on them */
  objects: SceneObject[]
}

/** a named pose: the joints it sets, by name; a list in the file sets them all, in order */
export interface NamedPose {
  joints: Record<string, number>
  /** where it is written, for errors */
  line: number
}

const SCENE_FILE = /^scenes\/([^/]+)\.ya?ml$/i
/** the names the VS Code extension can write (extension/src/logic.ts, isWritablePath) */
const SCENE_NAME = /^[a-z][a-z0-9-]*$/

/** a file name made into one a scene file can have, for the error that asks for it */
function suggestName(name: string): string {
  const plain = name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
  return plain || 'scene'
}
type SceneName = (typeof SCENE_NAMES)[number]
const TOP_KEYS = ['base', 'views', 'poses', 'objects']
const VIEW_KEYS = ['lookAt', 'offset', 'spring']

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)

/** the scene files among `files` (other paths are left alone), checked; throws on the first problem */
export function readSceneFiles(files: Record<string, string>): Map<string, SceneFile> {
  const out = new Map<string, SceneFile>()
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const m = SCENE_FILE.exec(path)
    if (!m) continue
    const extension = path.slice(path.lastIndexOf('.'))
    if (!SCENE_NAME.test(m[1]) || extension !== extension.toLowerCase()) {
      // the name is what slides write in `scene:`, and the editor can save only into such files
      throw new Error(
        `${path}: a scene file's name is lower-case letters, digits and dashes, starting with a letter ` +
          `(slides use it in 'scene:', and the editor saves into such files only). ` +
          `Rename it, for example to scenes/${suggestName(m[1])}${extension.toLowerCase()} ` +
          `(with git mv: renaming only the letter case in Explorer is invisible to git).`,
      )
    }
    const file = readSceneFile(path, m[1], text)
    const twin = out.get(file.name)
    if (twin) throw new Error(`${twin.path} and ${path} are both scene '${file.name}'; keep one of them`)
    out.set(file.name, file)
  }
  // scene files with the same base are one running scene, with one set of objects
  const withObjects = new Map<string, SceneFile>()
  for (const file of out.values()) {
    if (file.objects.length === 0) continue
    const other = withObjects.get(file.base)
    if (other) {
      throw new Error(
        `${other.path} and ${file.path} both have objects, and both build on '${file.base}'. Slides with either scene ` +
          `are one running scene, with one set of objects: keep the objects in one of the files`,
      )
    }
    withObjects.set(file.base, file)
  }
  return out
}

/** the objects of each running scene, by its base (`arm`, `agilus`), from the lecture's scene files */
export function lectureObjects(scenes: Map<string, SceneFile>): Record<string, SceneObject[]> {
  const out: Record<string, SceneObject[]> = {}
  for (const file of scenes.values()) if (file.objects.length > 0) out[file.base] = file.objects
  return out
}

function readSceneFile(path: string, name: string, text: string): SceneFile {
  const lines = new LineCounter()
  const doc = parseDocument(text.replace(/^﻿/, ''), { lineCounter: lines })
  const lineOf = (node: unknown): number => {
    const range = (node as { range?: [number, number, number] } | null)?.range
    return range ? lines.linePos(range[0]).line : 1
  }
  const fail = (node: unknown, message: string): never => {
    throw new Error(`${path}, line ${lineOf(node)}: ${message}`)
  }
  if (doc.errors.length > 0) {
    const error = doc.errors[0]
    throw new Error(`${path}, line ${error.linePos?.[0].line ?? 1}: ${error.message.split('\n')[0]}`)
  }
  // a shared value (`*name`, `<<: *name`) would make one saved view change others
  visit(doc, {
    Alias(_, node) {
      fail(node, "aliases (*name) aren't supported in scene files: write the values out, so saving one view changes only that view")
    },
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') fail(pair.key, "merge keys (<<) aren't supported in scene files: write the values out")
    },
  })
  const root = doc.contents
  if (!isMap(root)) {
    return fail(root, `a scene file is a YAML mapping, starting with 'base:' (the engine scene it builds on: ${SCENE_NAMES.join(', ')})`)
  }
  const pair = (map: { items: unknown[] }, key: string) =>
    map.items.find((p) => isScalar((p as Pair).key) && ((p as Pair).key as { value: unknown }).value === key) as Pair<Node, Node> | undefined
  for (const p of root.items as Pair<Node, Node>[]) {
    const key = isScalar(p.key) ? p.key.value : undefined
    if (typeof key !== 'string' || !TOP_KEYS.includes(key)) {
      const guess = typeof key === 'string' ? closest(key, TOP_KEYS) : undefined
      fail(p.key, `unknown key '${String(key)}'.${guess ? ` Did you mean '${guess}'?` : ''} A scene file has 'base', 'views', 'poses' and 'objects'`)
    }
  }

  const basePair = pair(root, 'base')
  const base = basePair && isScalar(basePair.value) ? basePair.value.value : undefined
  if (!basePair) fail(root, `'base:' is missing: the engine scene this file builds on (${SCENE_NAMES.join(', ')})`)
  if (base === undefined || base === null || base === '') {
    fail(basePair!.value ?? basePair!.key, `'base:' is empty or not a name: give the engine scene this file builds on (${SCENE_NAMES.join(', ')})`)
  }
  if (typeof base !== 'string' || !(SCENE_NAMES as readonly string[]).includes(base)) {
    fail(basePair!.value ?? basePair!.key, `base '${String(base)}' is not one of the engine's scenes: ${SCENE_NAMES.join(', ')}`)
  }

  const views = new Map<string, NamedView>()
  const viewsPair = pair(root, 'views')
  if (viewsPair && viewsPair.value !== null && !(isScalar(viewsPair.value) && viewsPair.value.value === null)) {
    const map = viewsPair.value
    if (!isMap(map)) fail(map, "'views' is a mapping of names to camera views")
    for (const p of (map as { items: Pair<Node, Node>[] }).items) {
      const viewName = isScalar(p.key) ? p.key.value : undefined
      if (typeof viewName !== 'string' || viewName.trim() === '' || viewName !== viewName.trim()) {
        fail(p.key, `a view's name is a word or two, such as 'overview' (got ${JSON.stringify(viewName)})`)
      }
      const name = viewName as string
      const where = `view '${name}'`
      const v = p.value
      if (!isMap(v)) fail(v ?? p.key, `${where} is a mapping with lookAt and offset`)
      const raw = (v as { toJSON(): unknown }).toJSON() as Record<string, unknown>
      for (const key of Object.keys(raw)) {
        if (key === 'distance') fail(pair(v as { items: unknown[] }, key)?.key, `${where} has 'distance'; a named view needs 'offset', so it looks the same from any slide`)
        if (!VIEW_KEYS.includes(key)) fail(pair(v as { items: unknown[] }, key)?.key, `${where} has unknown key '${key}' (a view has lookAt, offset and spring)`)
      }
      if (raw.lookAt === undefined) fail(p.key, `${where} has no lookAt: the point it looks at, [x, y, z], or an anchor of the scene`)
      if (typeof raw.lookAt !== 'string' && !isVec3(raw.lookAt)) {
        fail(pair(v as { items: unknown[] }, 'lookAt')?.value, `${where} lookAt must be [x, y, z] or an anchor name`)
      }
      if (raw.offset === undefined) fail(p.key, `${where} has no offset: where the camera is, [x, y, z] from the point it looks at`)
      if (!isVec3(raw.offset)) fail(pair(v as { items: unknown[] }, 'offset')?.value, `${where} offset must be [x, y, z] (numbers)`)
      const camera: CameraTargetSpec = { lookAt: raw.lookAt as CameraTargetSpec['lookAt'], offset: raw.offset as [number, number, number] }
      if (raw.spring !== undefined) {
        const spring = raw.spring as Record<string, unknown>
        const springNode = pair(v as { items: unknown[] }, 'spring')?.value
        if (typeof spring !== 'object' || spring === null || Array.isArray(spring)) fail(springNode, `${where} spring is a mapping, such as { omega: 4, zeta: 1 }`)
        for (const [key, value] of Object.entries(spring)) {
          if (!['omega', 'zeta'].includes(key) || !isFiniteNumber(value) || value <= 0) {
            fail(springNode, `${where} spring.${key} must be omega or zeta, a positive number`)
          }
        }
        camera.spring = spring as CameraTargetSpec['spring']
      }
      views.set(name, { camera, line: lineOf(p.key) })
    }
  }
  const poses = new Map<string, NamedPose>()
  const posesPair = pair(root, 'poses')
  if (posesPair && posesPair.value !== null && !(isScalar(posesPair.value) && posesPair.value.value === null)) {
    const map = posesPair.value
    if (!isMap(map)) fail(map, "'poses' is a mapping of names to poses")
    const joints = SCENE_JOINTS[base as SceneName]
    const names = joints.map((j) => j.name)
    // limits are shown to 3 decimals, rounded inward, so every value the message allows is
    // allowed (the 1e-6 slack is the check's own 1e-9 rad, and keeps 0.785 from showing as 0.784)
    const lower = (v: number) => Math.ceil(v * 1000 - 1e-6) / 1000
    const upper = (v: number) => Math.floor(v * 1000 + 1e-6) / 1000
    for (const p of (map as { items: Pair<Node, Node>[] }).items) {
      const poseName = isScalar(p.key) ? p.key.value : undefined
      if (typeof poseName !== 'string' || poseName.trim() === '' || poseName !== poseName.trim()) {
        fail(p.key, `a pose's name is a word or two, such as 'q0' (got ${JSON.stringify(poseName)})`)
      }
      const where = `pose '${poseName as string}'`
      const v = p.value
      const set: Record<string, number> = {}
      const check = (joint: string, value: unknown, node: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(node ?? p.key, `${where}: ${joint} must be a number (radians)`)
        const limits = joints.find((j) => j.name === joint)!
        if ((value as number) < limits.min - 1e-9 || (value as number) > limits.max + 1e-9) {
          fail(
            node ?? p.key,
            `${where} sets ${joint} to ${value as number}, outside its limits, ${lower(limits.min)} to ${upper(limits.max)} (radians)`,
          )
        }
        set[joint] = value as number
      }
      if (isSeq(v)) {
        // a list: every joint of the robot, in order
        if (v.items.length !== joints.length) {
          fail(v, `${where} lists ${v.items.length} value${v.items.length === 1 ? '' : 's'}, but '${base as string}' has ${joints.length} joints: ${names.join(', ')}`)
        }
        v.items.forEach((item, k) => check(names[k], isScalar(item) ? item.value : undefined, item))
      } else if (isMap(v)) {
        // a mapping: only the joints it names
        if (v.items.length === 0) fail(v, `${where} names no joints`)
        for (const q of v.items as Pair<Node, Node>[]) {
          const joint = isScalar(q.key) ? q.key.value : undefined
          if (typeof joint !== 'string' || !names.includes(joint)) {
            fail(q.key, `${where} names the joint '${String(joint)}', which '${base as string}' doesn't have. Its joints: ${names.join(', ')}`)
          }
          check(joint as string, isScalar(q.value) ? q.value.value : undefined, q.value)
        }
      } else {
        fail(v ?? p.key, `${where} is a list of the ${joints.length} joint values (${names.join(', ')}) or a mapping of joint names to values`)
      }
      poses.set(poseName as string, { joints: set, line: lineOf(p.key) })
    }
  }
  const objects = readObjects(pair(root, 'objects'), base as SceneName, fail)
  return { path, name, base: base as string, views, poses, objects }
}

type Fail = (node: unknown, message: string) => never

/** what each shape's size is, for its error */
const SIZE_OF: Record<(typeof OBJECT_SHAPES)[number], string> = {
  box: 'box must be [width, height, depth], in metres (positive numbers)',
  cylinder: 'cylinder must be [diameter, height], in metres (positive numbers)',
  sphere: 'sphere must be its diameter, in metres (a positive number)',
  frame: 'frame must be the length of its axes, in metres (a positive number)',
}
const OBJECT_KEYS = [...OBJECT_SHAPES, 'at', 'rotate', 'material', 'parent']
/** words from other tools for an object's keys */
const OBJECT_KEY_ALIASES: Record<string, string> = {
  position: 'at',
  pos: 'at',
  location: 'at',
  rotation: 'rotate',
  orientation: 'rotate',
  color: 'material',
  colour: 'material',
}
/** anything larger, or farther out, is metres written as millimetres (the floor grid is 5 m across) */
export const MAX_METRES = 10

/** the file's `objects:`, checked, parents before the objects on them */
function readObjects(objectsPair: Pair<Node, Node> | undefined, base: SceneName, fail: Fail): SceneObject[] {
  if (!objectsPair || objectsPair.value === null || (isScalar(objectsPair.value) && objectsPair.value.value === null)) return []
  const map = objectsPair.value
  if (!isMap(map)) fail(map, "'objects' is a mapping of names to objects")
  const { anchors, parents } = SCENE_ANCHORS[base]
  const read: Array<{ object: SceneObject; node: Node }> = []
  const pairs = (map as { items: Pair<Node, Node>[] }).items
  const names = pairs.map((p) => (isScalar(p.key) ? p.key.value : undefined))
  for (const p of pairs) {
    const objectName = isScalar(p.key) ? p.key.value : undefined
    if (typeof objectName !== 'string' || objectName.trim() === '' || objectName !== objectName.trim()) {
      fail(p.key, `an object's name is a word or two, such as 'table' (got ${JSON.stringify(objectName)})`)
    }
    const name = objectName as string
    const where = `object '${name}'`
    if (anchors.includes(name)) {
      fail(p.key, `${where} has the name of an anchor of '${base}' (${anchors.join(', ')}): slides look at and label both by name, so give the object another`)
    }
    // the scene keeps its anchors by name in a plain object, where these names are taken
    if (name in Object.prototype) fail(p.key, `${where} has a name JavaScript keeps for itself: give the object another`)
    const v = p.value
    const empty = v === null || (isScalar(v) && v.value === null) || (isMap(v) && v.items.length === 0)
    if (empty) {
      fail(v ?? p.key, `${where} has nothing in it: give it a shape (box, cylinder, sphere or frame) and where it is, at: [x, y, z]. With only at, it is an invisible point`)
    }
    if (!isMap(v)) fail(v, `${where} is a mapping: a shape (box, cylinder, sphere or frame) and where it is, at: [x, y, z]`)
    const entries = (v as { items: Pair<Node, Node>[] }).items
    const valueOf = (key: string) => entries.find((q) => isScalar(q.key) && q.key.value === key)
    for (const q of entries) {
      const key = isScalar(q.key) ? q.key.value : undefined
      if (typeof key === 'string' && OBJECT_KEYS.includes(key)) continue
      const known = 'An object has a shape (box, cylinder, sphere or frame), at, rotate, material and parent'
      const alias = typeof key === 'string' && Object.hasOwn(OBJECT_KEY_ALIASES, key.toLowerCase()) ? OBJECT_KEY_ALIASES[key.toLowerCase()] : undefined
      const guess = typeof key === 'string' ? (alias ?? closest(key, OBJECT_KEYS)) : undefined
      if (key === 'size') fail(q.key, `${where} has 'size': write the size with the shape, such as box: [0.4, 0.2, 0.4]. ${known}`)
      fail(q.key, `${where} has unknown key '${String(key)}'.${guess ? ` Did you mean '${guess}'?` : ''} ${known}`)
    }
    const shapes = OBJECT_SHAPES.filter((shape) => valueOf(shape))
    if (shapes.length > 1) fail(valueOf(shapes[1])!.key, `${where} has both ${shapes[0]} and ${shapes[1]}: one shape per object`)
    const shape: ObjectShape = shapes.length > 0 ? shapes[0] : 'point'
    const metres = (value: number, node: unknown, what: string) => {
      if (Math.abs(value) > MAX_METRES) {
        fail(node, `${where} ${what} has ${value}, which is ${value} m: sizes and places are in metres (${value} mm is ${value / 1000})`)
      }
    }

    let size: number[] = []
    if (shape !== 'point') {
      const node = valueOf(shape)!.value
      const count = shape === 'box' ? 3 : shape === 'cylinder' ? 2 : 1
      // each number with its own node, so an error names the line of the one that is wrong
      const items: Array<{ value: unknown; node: unknown }> =
        count === 1
          ? [{ value: isScalar(node) ? node.value : undefined, node }]
          : isSeq(node) && node.items.length === count
            ? node.items.map((item) => ({ value: isScalar(item) ? item.value : undefined, node: item }))
            : fail(node ?? p.key, `${where} ${SIZE_OF[shape]}`)
      for (const item of items) {
        if (!isFiniteNumber(item.value) || item.value <= 0) fail(item.node ?? node ?? p.key, `${where} ${SIZE_OF[shape]}`)
        metres(item.value as number, item.node, shape)
      }
      size = items.map((item) => item.value as number)
    }

    /** in a list of three, the first item that isn't a number, whose line an error names; otherwise the node */
    const wrongIn = (node: unknown): unknown => {
      if (!isSeq(node) || node.items.length !== 3) return node
      const k = node.items.findIndex((item) => !isScalar(item) || !isFiniteNumber(item.value))
      return k < 0 ? node : (node.items[k] ?? node)
    }

    let at: [number, number, number] = [0, 0, 0]
    const atPair = valueOf('at')
    if (atPair) {
      const raw = (atPair.value as { toJSON?(): unknown } | null)?.toJSON?.()
      const what = shape === 'point' ? 'the point' : shape === 'frame' ? 'its origin' : 'the middle of its underside'
      if (!isVec3(raw)) fail(wrongIn(atPair.value) ?? atPair.key, `${where} at must be [x, y, z], in metres: ${what}`)
      at = raw as [number, number, number]
      const items = isSeq(atPair.value) ? atPair.value.items : []
      at.forEach((n, k) => metres(n, items[k] ?? atPair.value, 'at'))
    }

    let rotate: [number, number, number] = [0, 0, 0]
    const rotatePair = valueOf('rotate')
    if (rotatePair) {
      const node = rotatePair.value
      const raw = isScalar(node) ? node.value : (node as { toJSON?(): unknown } | null)?.toJSON?.()
      if (isFiniteNumber(raw)) rotate = [0, raw, 0]
      else if (isVec3(raw)) rotate = raw
      else {
        fail(
          wrongIn(node) ?? rotatePair.key,
          `${where} rotate must be degrees about y (a number, such as 90: about the vertical, or the parent's y), or about x, y and z ([0, 90, 0])`,
        )
      }
    }

    let material: ObjectMaterial | undefined
    const materialPair = valueOf('material')
    if (materialPair) {
      if (shape === 'frame') fail(materialPair.key, `${where} is a frame, drawn in the axis colours (x red, y green, z blue): it has no material`)
      if (shape === 'point') {
        fail(materialPair.key, `${where} has no shape, so it is an invisible point: it has no material. Give it a shape, such as box: [0.1, 0.1, 0.1]`)
      }
      const value = isScalar(materialPair.value) ? materialPair.value.value : undefined
      if (typeof value !== 'string' || !(OBJECT_MATERIALS as readonly string[]).includes(value)) {
        const guess = typeof value === 'string' ? closest(value, OBJECT_MATERIALS) : undefined
        fail(
          materialPair.value ?? materialPair.key,
          `${where} material '${String(value)}' isn't one of the colours.${guess ? ` Did you mean '${guess}'?` : ''} The colours: ${OBJECT_MATERIALS.join(', ')}`,
        )
      }
      material = value as ObjectMaterial
    }

    let parent: string | undefined
    const parentPair = valueOf('parent')
    if (parentPair) {
      const value = isScalar(parentPair.value) ? parentPair.value.value : undefined
      const node = parentPair.value ?? parentPair.key
      const others = names.filter((n): n is string => typeof n === 'string' && n !== name)
      // in agilus-duo no anchor can be a parent: say so, rather than offer them
      const what =
        parents.length > 0
          ? `another object in this file, or an anchor of '${base}' (${parents.join(', ')})`
          : `another object in this file (in '${base}' objects can't hang on the robots)`
      if (typeof value !== 'string' || value === '') fail(node, `${where} parent must be the name of ${what}`)
      if (value === name) fail(node, `${where} can't be its own parent`)
      if (anchors.includes(value as string) && !parents.includes(value as string)) {
        fail(node, `${where} has the parent '${value as string}', but in '${base}' objects can't hang on the robots (a slide can draw robot 0 as the ghost). Leave out parent, and the object stands in the scene`)
      }
      if (!others.includes(value as string) && !parents.includes(value as string)) {
        const guess = closest(value as string, [...others, ...parents])
        fail(
          node,
          `${where} has the parent '${value as string}', which is ${parents.length > 0 ? `neither an object in this file nor an anchor of '${base}'` : 'not an object in this file'}.` +
            `${guess ? ` Did you mean '${guess}'?` : ''} The parent is ${what}`,
        )
      }
      parent = value as string
    }
    const object: SceneObject = { name, shape, size, at, rotate }
    if (shape !== 'point' && shape !== 'frame') object.material = material ?? 'grey'
    if (parent !== undefined) object.parent = parent
    read.push({ object, node: p.key })
  }

  // parents first, each object after the one it hangs on, otherwise in the file's order
  const out: SceneObject[] = []
  const placed = new Set<string>()
  let left = read
  while (left.length > 0) {
    const ready = left.filter(({ object }) => object.parent === undefined || parents.includes(object.parent) || placed.has(object.parent))
    if (ready.length === 0) {
      // every object left hangs on another one left: follow the parents until one comes round
      // again, and name only the ring (not the objects that merely hang on it), in the file's order
      const byName = new Map(left.map((entry) => [entry.object.name, entry]))
      const path: string[] = []
      let step = left[0]
      while (!path.includes(step.object.name)) {
        path.push(step.object.name)
        step = byName.get(step.object.parent!)!
      }
      const ring = path.slice(path.indexOf(step.object.name))
      const members = left.filter(({ object }) => ring.includes(object.name))
      const names = members.map(({ object }) => `'${object.name}'`).join(', ')
      fail(members[0].node, `the objects ${names} hang on each other in a ring: one of them must stand in the scene (no parent), or on an anchor`)
    }
    for (const { object } of ready) {
      out.push(object)
      placed.add(object.name)
    }
    left = left.filter((entry) => !ready.includes(entry))
  }
  return out
}
