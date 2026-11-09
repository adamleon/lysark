import { isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from 'yaml'
import { readSceneFiles } from '../compiler/scene-files'
import type { SceneObject } from '../engine/object-types'
import { applyEdits, keyName, plainText, type Edit, type Range } from './camera-edit'
import { singleEdit } from './slide-match'

/**
 * The text edits that move an object from the panel (step 7 of
 * docs/scene-files-proposal.md; docs/scene-files.md, "Moving objects in the
 * editor"): its `at` and `rotate` in the scene file that has the scene's
 * objects. Only the numbers that changed are written, each where it stands;
 * every other line, comment and spacing stays byte for byte.
 */

export type Vec3 = [number, number, number]

/** where an object is: `at` in metres and `rotate` in degrees, in its parent's frame, as the scene file says */
export interface ObjectPlace {
  at: Vec3
  rotate: Vec3
}

type Change = { start: number; end: number; text: string }

/**
 * The scene file of `files` that has the objects of the engine scene `base`
 * (only one file per base may have them), and their names in the file's
 * order; null if none has any, or the scene files don't read.
 */
export function objectsFile(files: Record<string, string>, base: string): { path: string; names: string[] } | null {
  let scenes
  try {
    scenes = readSceneFiles(files)
  } catch {
    return null
  }
  for (const file of scenes.values()) {
    if (file.base !== base || file.objects.length === 0) continue
    // the compiler puts parents first; the file's own order is its keys'
    const objects = parseDocument(files[file.path]).get('objects')
    const order = isMap(objects) ? objects.items.map((p) => keyName(p as Pair)) : []
    const names = file.objects.map((o) => o.name).sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return { path: file.path, names }
  }
  return null
}

/** a list of numbers as the editor writes one: `[0.6, 0, -0.7]` */
const list = (v: number[]) => `[${v.join(', ')}]`

/** `rotate` as the editor writes a new one: a number when it turns only about y, a list otherwise */
const rotateText = (r: Vec3) => (r[0] === 0 && r[2] === 0 ? String(r[1]) : list(r))

/** a node written as a plain number: no tag (`!!float`) or anchor (`&a`) that would apply to the new one */
function plainNumber(node: unknown): node is { value: number; range: Range } {
  const n = node as { tag?: string; anchor?: string; range?: Range | null }
  return isScalar(node) && typeof node.value === 'number' && !n.tag && !n.anchor && !!n.range
}

/** the edits that write `values` into a list of three plain numbers, each that differs where it stands */
function listEdits(pair: Pair, values: Vec3, what: string): Edit[] {
  const value = pair.value as { items?: unknown[]; tag?: string; anchor?: string } | null
  if (!isSeq(value) || value.items.length !== 3 || value.tag || value.anchor || !value.items.every(plainNumber)) {
    throw new Error(`${what} isn't written as three plain numbers, [x, y, z], so it can't be moved from the panel; change it by hand`)
  }
  const items = value.items as Array<{ value: number; range: Range }>
  return items.flatMap((item, k) => (item.value === values[k] ? [] : [{ start: item.range[0], end: item.range[1], text: String(values[k]) }]))
}

/** the edit that adds `entries` (key, text) to an object's mapping: after its last entry, indented as the others */
function addEntries(yaml: string, map: YAMLMap<unknown, unknown> & { range?: Range }, entries: Array<[string, string]>): Edit {
  const last = map.items[map.items.length - 1] as Pair | undefined
  if (!last || !map.range) throw new Error('the object has no position in the text')
  const lastRange = ((last.value as { range?: Range } | null)?.range ?? (last.key as { range: Range }).range)
  if (map.flow) {
    // `{ box: [0.4, 0.2, 0.4] }`: more entries before the closing brace
    return { start: lastRange[1], end: lastRange[1], text: entries.map(([k, t]) => `, ${k}: ${t}`).join('') }
  }
  // the mapping's own indentation, as the parser read it (its key nodes may start after `? `, a tag or an anchor)
  const block = (map as { srcToken?: { indent?: unknown } }).srcToken
  if (typeof block?.indent !== 'number') throw new Error("the object's keys have no indentation in the text")
  const indent = ' '.repeat(block.indent)
  // after the line the last entry ends on (its node takes in a comment on that line, and a block list's lines)
  let end = lastRange[2]
  while (end > 0 && /\s/.test(yaml[end - 1])) end--
  const lines = entries.map(([k, t]) => `${indent}${k}: ${t}`)
  const lineEnd = yaml.indexOf('\n', end)
  if (lineEnd < 0) return { start: yaml.length, end: yaml.length, text: `\n${lines.join('\n')}` }
  return { start: lineEnd + 1, end: lineEnd + 1, text: lines.map((l) => `${l}\n`).join('') }
}

/** an object's `at` or `rotate` as the compiler reads it (none: [0, 0, 0]; a number n: [0, n, 0]); null if neither */
function readPlace(pair: Pair | undefined, key: 'at' | 'rotate'): Vec3 | null {
  if (!pair) return [0, 0, 0]
  const value = pair.value as { toJSON?(): unknown } | null
  const raw = isScalar(value) ? value.value : value?.toJSON?.()
  if (key === 'rotate' && typeof raw === 'number') return [0, raw, 0]
  return Array.isArray(raw) && raw.length === 3 && raw.every((n) => typeof n === 'number') ? (raw as Vec3) : null
}

/**
 * The whole scene file with the object `name` at `place` (its `at`, its
 * `rotate`, or both). A number that differs from the one written is
 * replaced where it stands; `rotate: 48` stays a number while the object
 * turns only about y, and becomes a list when it doesn't. An `at` or
 * `rotate` the object didn't have is added after its other keys (not if it
 * would be [0, 0, 0], the value without one). Line endings and a byte-order
 * mark are kept.
 *
 * `from`: where the panel showed the object when it was moved. If the file
 * says otherwise for a part `place` writes (typing the panel hasn't had,
 * say), the move is refused rather than written over it.
 */
export function setObjectPlace(source: string, name: string, place: Partial<ObjectPlace>, from?: ObjectPlace): string {
  const { yaml, restore } = plainText(source)
  // (with the parser's tokens: a mapping's indentation, for keys added to it)
  const doc = parseDocument(yaml, { keepSourceTokens: true })
  if (doc.errors.length > 0) throw new Error(`the scene file has a YAML error, so the object can't be moved: ${doc.errors[0].message}`)
  const objects = doc.get('objects', true)
  const entry = isMap(objects) ? (objects.items.find((p) => keyName(p as Pair) === name) as Pair | undefined) : undefined
  if (!entry || !isMap(entry.value)) throw new Error(`the scene file has no object '${name}' to move`)
  const map = entry.value as YAMLMap<unknown, unknown> & { range?: Range }
  const pairOf = (key: string) => map.items.find((p) => keyName(p as Pair) === key) as Pair | undefined
  if (from) {
    for (const key of ['at', 'rotate'] as const) {
      const written = readPlace(pairOf(key), key)
      if (place[key] && JSON.stringify(written) !== JSON.stringify(from[key])) {
        throw new Error(
          `the scene file has '${name}' ${key === 'at' ? 'elsewhere' : 'turned otherwise'} than the panel shows (${key}: ${written ? list(written) : 'not plain numbers'}; ` +
            'typing the panel has not had yet?): save the file (Ctrl+S), then try again',
        )
      }
    }
  }
  const edits: Edit[] = []
  const added: Array<[string, string]> = []
  const zero = (v: Vec3) => v.every((n) => n === 0)
  if (place.at) {
    const pair = pairOf('at')
    if (pair) edits.push(...listEdits(pair, place.at, `object '${name}' at`))
    else if (!zero(place.at)) added.push(['at', list(place.at)])
  }
  if (place.rotate) {
    const r = place.rotate
    const pair = pairOf('rotate')
    if (!pair) {
      if (!zero(r)) added.push(['rotate', rotateText(r)])
    } else if (isScalar(pair.value)) {
      // `rotate: 48`, degrees about y
      if (!plainNumber(pair.value)) {
        throw new Error(`object '${name}' rotate isn't written as a plain number or [x, y, z], so it can't be turned from the panel; change it by hand`)
      }
      const { value, range } = pair.value
      const text = rotateText(r)
      if (!(r[0] === 0 && r[2] === 0 && value === r[1])) edits.push({ start: range[0], end: range[1], text })
    } else edits.push(...listEdits(pair, r, `object '${name}' rotate`))
  }
  if (added.length > 0) edits.push(addEntries(yaml, map, added))
  return restore(applyEdits(yaml, edits))
}

/**
 * The edit that moves the object `name` from `from` (where the panel showed
 * it) to `place`, in a scene file's text: only the parts that changed, `at`
 * or `rotate`, are written. null if it is there already.
 */
export function objectEdit(sceneText: string, name: string, place: ObjectPlace, from: ObjectPlace): Change | null | { problem: string } {
  const changed: Partial<ObjectPlace> = {}
  if (JSON.stringify(place.at) !== JSON.stringify(from.at)) changed.at = place.at
  if (JSON.stringify(place.rotate) !== JSON.stringify(from.rotate)) changed.rotate = place.rotate
  if (!changed.at && !changed.rotate) return null
  try {
    return singleEdit(sceneText, setObjectPlace(sceneText, name, changed, from))
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}

/** an object's place for people: `at [0.62, 0, -0.69] · rotate 48` */
export function placeText(place: ObjectPlace): string {
  return `at ${list(place.at)} · rotate ${rotateText(place.rotate)}`
}

/**
 * The objects whose place (`at`, `rotate`) differs between the objects a
 * deck runs with and new ones, each with its scene and its new data; null if
 * anything else differs (an object added, removed or renamed, or a shape,
 * size, colour or parent changed), which needs the scene built afresh.
 */
export function placementChanges(
  before: Record<string, SceneObject[]>,
  after: Record<string, SceneObject[]>,
): Array<{ scene: string; index: number; object: SceneObject }> | null {
  const out: Array<{ scene: string; index: number; object: SceneObject }> = []
  for (const scene of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[scene] ?? []
    const b = after[scene] ?? []
    if (a.length !== b.length) return null
    for (let i = 0; i < a.length; i++) {
      const same = (key: keyof SceneObject) => JSON.stringify(a[i][key]) === JSON.stringify(b[i][key])
      if (!(['name', 'shape', 'size', 'material', 'parent'] as const).every(same)) return null
      if (!same('at') || !same('rotate')) out.push({ scene, index: i, object: b[i] })
    }
  }
  return out
}
