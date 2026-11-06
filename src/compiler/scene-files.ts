import { isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node, type Pair } from 'yaml'
import type { CameraTargetSpec } from '../engine/slide-types'
import { SCENE_JOINTS } from '../scenes/joints'
import { SCENE_NAMES } from '../scenes/registry'

/**
 * A lecture's scene files (scene-files-proposal.md, docs/scene-files.md):
 * `scenes/<name>.yaml` next to slides.md, building on one of the engine's
 * scenes and adding named camera views. The compiler never reads files: the
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
const TOP_KEYS = ['base', 'views', 'poses']
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
      fail(p.key, `unknown key '${String(key)}'. A scene file has 'base', 'views' and 'poses'`)
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
    const joints = SCENE_JOINTS[base as (typeof SCENE_NAMES)[number]]
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
  return { path, name, base: base as string, views, poses }
}
