import { isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from 'yaml'
import { compileLecture } from '../compiler/compile-slides'
import { readSceneFiles } from '../compiler/scene-files'
import { slideRanges, splitLines } from '../compiler/slide-ranges'
import { SCENE_JOINTS, type JointInfo } from '../scenes/joints'
import { SCENE_NAMES } from '../scenes/registry'
import { applyEdits, keyName, lineStart, plainText, setValue, type Edit, type Range } from './camera-edit'
import { slideHeads } from './save-view'
import { matchSlide, singleEdit } from './slide-match'

/**
 * The text edits that save the robot's pose from the panel (P,
 * docs/scene-files.md): into the slide's own `joints:` block, or, on a slide
 * that names a pose (`joints: reach`), into that pose in the scene file. Only
 * the joints given change, each where it is written (a list pose stays a
 * list); every other line, comment and spacing stays byte for byte.
 */

type Change = { start: number; end: number; text: string }

/** the joints a pose sets in the engine scene `scene`, in order, with their limits; [] for another scene */
export function sceneJoints(scene: string): JointInfo[] {
  return (SCENE_NAMES as readonly string[]).includes(scene) ? SCENE_JOINTS[scene as (typeof SCENE_NAMES)[number]] : []
}

/**
 * A joint value as P writes it: radians to two decimals, inside the joint's
 * limits (rounded inward, so the build never refuses what P writes).
 */
export function poseValue(value: number, joint: JointInfo): number {
  const min = Math.ceil(joint.min * 100 - 1e-6) / 100
  const max = Math.floor(joint.max * 100 + 1e-6) / 100
  const v = Number(Math.min(Math.max(value, min), max).toFixed(2))
  return v === 0 ? 0 : v // no -0
}

/** how a pose edit treats a joint written with a tag or an anchor */
interface PoseEditOptions {
  /** write over it anyway: only for a probe whose text is never written (poseUsers) */
  overProps?: boolean
}

/**
 * The edit to a mapping of joints (a slide's `joints:` block, or a pose
 * written as a mapping): each joint in `values` set where it is written, or
 * added after the others.
 */
function editJointsMapping(yaml: string, map: YAMLMap<unknown, unknown>, values: Record<string, number>, options: PoseEditOptions = {}): string {
  if (!map.range) throw new Error('the joints have no position in the text')
  const pairOf = (name: string) => map.items.find((p) => keyName(p as Pair) === name) as Pair | undefined
  const edits: Edit[] = []
  const missing: Array<[string, number]> = []
  for (const [joint, value] of Object.entries(values)) {
    const pair = pairOf(joint)
    if (!pair) {
      missing.push([joint, value])
      continue
    }
    // a tag (`!!int`) would apply to the new number, and an anchor (`&q`) would
    // carry it to the joints that refer to it: leave such a joint to the author
    const written = pair.value as { tag?: string; anchor?: string } | null
    if (written && (written.tag || written.anchor) && !options.overProps) {
      throw new Error(`${joint} isn't written as a plain number (it has a tag or an anchor), so the pose can't be saved into it; change it by hand`)
    }
    edits.push(...setValue(yaml, pair, String(value)))
  }
  if (missing.length > 0) {
    if (map.flow) {
      // `{ joint2: 0.3 }`: one more entry before the closing brace
      const entries = missing.map(([joint, value]) => `${joint}: ${value}`).join(', ')
      if (map.items.length === 0) {
        edits.push({ start: map.range[0], end: map.range[1], text: `{ ${entries} }` })
      } else {
        const last = map.items[map.items.length - 1] as Pair
        const at = ((last.value as { range?: Range } | null)?.range ?? (last.key as { range: Range }).range)[1]
        edits.push({ start: at, end: at, text: `, ${entries}` })
      }
    } else {
      // block style: after the last joint, indented as the others
      const firstKey = map.items[0]?.key as { range?: Range } | undefined
      const indent = firstKey?.range ? ' '.repeat(firstKey.range[0] - lineStart(yaml, firstKey.range[0])) : '  '
      const at = map.range[1]
      let text = (at > 0 && yaml[at - 1] !== '\n' ? '\n' : '') + missing.map(([joint, value]) => `${indent}${joint}: ${value}\n`).join('')
      // nothing follows and the text had no final newline: don't add one
      if (at === yaml.length && yaml[at - 1] !== '\n') text = text.replace(/\n$/, '')
      edits.push({ start: at, end: at, text })
    }
  }
  return applyEdits(yaml, edits)
}

/** the pose edit for one slide's YAML (without its `---` fences) */
function editJointsYaml(yaml: string, values: Record<string, number>): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) {
    throw new Error(`this slide's frontmatter has a YAML error, so the pose can't be saved: ${doc.errors[0].message}`)
  }
  const root = doc.contents
  if (root !== null && !isMap(root)) throw new Error("this slide's frontmatter is not a YAML mapping")
  const pair = root?.items.find((p) => keyName(p as Pair) === 'joints') as Pair | undefined
  const value = pair?.value
  if (isMap(value)) return editJointsMapping(yaml, value as YAMLMap<unknown, unknown>, values)
  const empty = value === null || value === undefined || (isScalar(value) && value.value === null)
  if (!empty) {
    throw new Error(
      isScalar(value) && typeof value.value === 'string'
        ? `this slide names the pose '${value.value}'`
        : "this slide's joints: is not a mapping of joints to radians",
    )
  }
  // no joints on this slide yet, or an empty `joints:`: a block of its own
  const lines = Object.entries(values).map(([joint, v]) => `\n  ${joint}: ${v}`).join('')
  if (pair && isScalar(pair.key) && pair.key.range) {
    // `joints:` keeps its line and a comment on it; what stood for nothing (a
    // `~` or `null`, a tag, an anchor) goes. The joints go under it, or where
    // a `~` written on a later line stood, below the comment lines before it
    const start = pair.key.range[0]
    const lineEnd = (at: number) => (yaml.indexOf('\n', at) < 0 ? yaml.length : yaml.indexOf('\n', at))
    const colon = yaml.indexOf(':', pair.key.range[1])
    const keyLineEnd = lineEnd(colon)
    const head = yaml.slice(start, colon + 1) + commentOf(yaml.slice(colon + 1, keyLineEnd))
    const range = (value as { range?: Range } | null | undefined)?.range
    if (range && range[1] > range[0] && range[0] > keyLineEnd) {
      const nullStart = lineStart(yaml, range[0])
      const nullEnd = lineEnd(range[1])
      const indent = /^[ \t]*/.exec(yaml.slice(nullStart, range[0]))![0]
      const comment = commentOf(yaml.slice(range[1], nullEnd)).trimStart()
      return (
        yaml.slice(0, start) + head + yaml.slice(keyLineEnd, nullStart - 1) + (comment ? `\n${indent}${comment}` : '') + lines + yaml.slice(nullEnd)
      )
    }
    return yaml.slice(0, start) + head + lines + yaml.slice(keyLineEnd)
  }
  const block = `joints:${lines}`
  if (yaml.trim() === '') return block
  return yaml.replace(/\n*$/, '') + '\n' + block + (yaml.endsWith('\n') ? '\n' : '')
}

/** a YAML comment at the end of `text` (part of one line), with the spaces before it; '' if none */
function commentOf(text: string): string {
  for (let at = text.indexOf('#'); at >= 0; at = text.indexOf('#', at + 1)) {
    if (at > 0 && !/\s/.test(text[at - 1])) continue // `a#b` isn't a comment
    let from = at
    while (from > 0 && /\s/.test(text[from - 1])) from--
    return text.slice(from)
  }
  return ''
}

/** the whole slides.md with `values` (joint → radians) written into slide `slideIndex`'s `joints:` (0-based) */
export function setSlideJoints(source: string, slideIndex: number, values: Record<string, number>): string {
  const r = slideRanges(source)[slideIndex]
  if (!r) throw new Error(`there is no slide ${slideIndex + 1}`)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines = splitLines(source)
  const edited = editJointsYaml(lines.slice(r.yamlStart, r.yamlEnd).join('\n'), values)
  const yamlLines = edited === '' ? [] : edited.split('\n')
  return bom + [...lines.slice(0, r.yamlStart), ...yamlLines, ...lines.slice(r.yamlEnd)].join(eol)
}

/**
 * The whole scene file with `values` written into the pose `name`, which must
 * exist: a list's numbers replaced where they stand (`order` gives the joint
 * of each place), a mapping's set or added. Line endings and a byte-order
 * mark are kept.
 */
export function setNamedPose(
  source: string,
  name: string,
  values: Record<string, number>,
  order: string[],
  options: PoseEditOptions = {},
): string {
  const { yaml, restore } = plainText(source)
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) throw new Error(`the scene file has a YAML error, so the pose can't be saved: ${doc.errors[0].message}`)
  const poses = doc.get('poses', true)
  const pose = isMap(poses) ? poses.get(name, true) : undefined
  if (isMap(pose)) return restore(editJointsMapping(yaml, pose as YAMLMap<unknown, unknown>, values, options))
  if (!isSeq(pose)) throw new Error(`the scene file has no pose '${name}' to save into`)
  const items = pose.items as Array<{ range?: Range | null; value?: unknown; tag?: string; anchor?: string }>
  if (items.length !== order.length) {
    throw new Error(`the pose '${name}' lists ${items.length} values, but the robot has ${order.length} joints; correct it by hand first`)
  }
  const edits: Edit[] = []
  for (const [joint, value] of Object.entries(values)) {
    const item = items[order.indexOf(joint)]
    // a tag (`!!float`) or an anchor (`&a`) would apply to the new number: leave such a pose to the author
    if (!isScalar(item) || typeof item.value !== 'number' || ((item.tag || item.anchor) && !options.overProps) || !item.range) {
      throw new Error(`the pose '${name}' isn't written as plain numbers, so it can't be saved into; change it by hand`)
    }
    edits.push({ start: item.range[0], end: item.range[1], text: String(value) })
  }
  return restore(applyEdits(yaml, edits))
}

/** where P writes for a slide that names a pose: the pose, its scene file, and the slides that name it */
export interface PoseTarget {
  pose: string
  /** `scenes/<scene>.yaml` (or `.yml`), as in `files` */
  path: string
  /** the slides (0-based) whose own `joints:` names this pose */
  users: number[]
}

/**
 * Where P writes for slide `index` of `files['slides.md']`: the pose the
 * slide names, in the lecture's scene file for its scene; null if the slide
 * has its own joint values, or none (P then writes into the slide).
 */
export function poseTarget(files: Record<string, string>, index: number): PoseTarget | null {
  const heads = slideHeads(files['slides.md'] ?? '')
  const head = heads[index]
  if (!head || typeof head.joints !== 'string' || typeof head.scene !== 'string') return null
  const path = [`scenes/${head.scene}.yaml`, `scenes/${head.scene}.yml`].find((p) => typeof files[p] === 'string')
  if (!path) return null
  const users = heads.flatMap((h, i) => (h.scene === head.scene && h.joints === head.joints ? [i] : []))
  return { pose: head.joints, path, users }
}

/**
 * The edit that writes `values` into slide `slide` of `shown` (the text the
 * panel shows), applied to `current`, slides.md as it is now in VS Code,
 * unsaved typing included. null if the slide has these values already.
 */
export function poseEdit(shown: string, current: string, slide: number, values: Record<string, number>): Change | null | { problem: string } {
  const index = matchSlide(shown, current, slide)
  if (index < 0) {
    return {
      problem: 'that slide has been edited since the preview last updated. Save the file (Ctrl+S), then save the pose again.',
    }
  }
  try {
    return singleEdit(current, setSlideJoints(current, index, values))
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}

/** the edit that writes `values` into the pose `name` of a scene file's text; null if it has them already */
export function namedPoseEdit(sceneText: string, name: string, values: Record<string, number>, order: string[]): Change | null | { problem: string } {
  try {
    return singleEdit(sceneText, setNamedPose(sceneText, name, values, order))
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}

/** how a compiled slide moves the robot: its joints, and its trajectory (whose ends may be poses) */
export function motionOf(slide: { effective: { joints?: unknown }; trajectory?: unknown }): string {
  return JSON.stringify([slide.effective.joints ?? null, slide.trajectory ?? null])
}

/**
 * The slides (0-based) whose robot the named pose moves: those that name it,
 * those that carry it on, and trajectories that start or end in it, found by
 * compiling with the pose nudged (a millionth of a radian, inside the limits).
 * `shown`: motionOf each slide as the files compile now (the running deck has
 * them). The slides that name it if the files don't compile.
 */
export function poseUsers(files: Record<string, string>, target: PoseTarget, shown: string[]): number[] {
  try {
    const name = target.path.replace(/^scenes\//, '').replace(/\.ya?ml$/i, '')
    const scene = readSceneFiles({ [target.path]: files[target.path] }).get(name)
    const pose = scene?.poses.get(target.pose)
    if (!scene || !pose) return target.users
    const joints = sceneJoints(scene.base)
    const nudged = Object.fromEntries(
      Object.entries(pose.joints).map(([joint, v]) => {
        const max = joints.find((j) => j.name === joint)?.max ?? Infinity
        return [joint, v + 1e-6 <= max ? v + 1e-6 : v - 1e-6]
      }),
    )
    const moved = setNamedPose(files[target.path], target.pose, nudged, joints.map((j) => j.name), { overProps: true })
    const now = compileLecture(files['slides.md'], { ...files, [target.path]: moved }).slides
    return now.flatMap((s, i) => (motionOf(s) !== shown[i] ? [i] : []))
  } catch {
    return target.users
  }
}
