import { isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from 'yaml'
import { compileLecture } from '../compiler/compile-slides'
import { readSceneFiles, type SceneFile } from '../compiler/scene-files'
import { slideRanges, splitLines } from '../compiler/slide-ranges'
import { SCENE_JOINTS, type JointInfo } from '../scenes/joints'
import { SCENE_NAMES } from '../scenes/registry'
import {
  addNamedEntry,
  applyEdits,
  commentOf,
  keyName,
  lineStart,
  nameProblem,
  plainText,
  setSlideName,
  setValue,
  type Edit,
  type Range,
} from './camera-edit'
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
 * A joint's value as Save pose as… writes it: a moved joint where the robot
 * holds it (two decimals, inside its limits); one that isn't, as the slide or
 * the scene puts it (`target`), or the limit, rounded inward, if that is
 * outside it; one that neither puts anywhere, where the robot holds it.
 */
export function poseJointValue(joint: JointInfo, setpoint: number, target: number | undefined, moved: boolean): number {
  if (moved || target === undefined) return poseValue(setpoint, joint)
  if (target >= joint.min - 1e-9 && target <= joint.max + 1e-9) return target
  return poseValue(target, joint)
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
    if (isScalar(pair.value) && pair.value.value === value) continue // already that number, as written
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
function editJointsYaml(yaml: string, values: Record<string, number>, replaceName = false): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) {
    throw new Error(`this slide's frontmatter has a YAML error, so the pose can't be saved: ${doc.errors[0].message}`)
  }
  const root = doc.contents
  if (root !== null && !isMap(root)) throw new Error("this slide's frontmatter is not a YAML mapping")
  const pair = root?.items.find((p) => keyName(p as Pair) === 'joints') as Pair | undefined
  const value = pair?.value
  if (isMap(value)) return editJointsMapping(yaml, value as YAMLMap<unknown, unknown>, values)
  const empty =
    value === null ||
    value === undefined ||
    (isScalar(value) && (value.value === null || (replaceName && typeof value.value === 'string')))
  if (!empty) {
    throw new Error(
      isScalar(value) && typeof value.value === 'string'
        ? `this slide names the pose '${value.value}'`
        : "this slide's joints: is not a mapping of joints to radians",
    )
  }
  // no joints on this slide yet, an empty `joints:`, or (replaceName) the name of a pose: a block of its own
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
    if (range && range[1] > range[0]) {
      // the value's last character (a block scalar's range runs on past its newline)
      let end = range[1]
      while (end > range[0] && /\s/.test(yaml[end - 1])) end--
      if (range[0] > keyLineEnd) {
        const nullStart = lineStart(yaml, range[0])
        const nullEnd = lineEnd(end)
        const indent = /^[ \t]*/.exec(yaml.slice(nullStart, range[0]))![0]
        const comment = commentOf(yaml.slice(end, nullEnd)).trimStart()
        return (
          yaml.slice(0, start) + head + yaml.slice(keyLineEnd, nullStart - 1) + (comment ? `\n${indent}${comment}` : '') + lines + yaml.slice(nullEnd)
        )
      }
      // a value from the key's line over the next (a block scalar `>-`): its lines go too
      if (end > keyLineEnd) return yaml.slice(0, start) + head + lines + yaml.slice(lineEnd(end))
    }
    return yaml.slice(0, start) + head + lines + yaml.slice(keyLineEnd)
  }
  const block = `joints:${lines}`
  if (yaml.trim() === '') return block
  return yaml.replace(/\n*$/, '') + '\n' + block + (yaml.endsWith('\n') ? '\n' : '')
}

/**
 * The whole slides.md with `values` (joint → radians) written into slide
 * `slideIndex`'s `joints:` (0-based). `replaceName`: a pose the slide names
 * is replaced with a block of `values` (Save pose as… only this slide);
 * otherwise such a slide is refused.
 */
export function setSlideJoints(source: string, slideIndex: number, values: Record<string, number>, replaceName = false): string {
  const r = slideRanges(source)[slideIndex]
  if (!r) throw new Error(`there is no slide ${slideIndex + 1}`)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines = splitLines(source)
  const edited = editJointsYaml(lines.slice(r.yamlStart, r.yamlEnd).join('\n'), values, replaceName)
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
    if (isScalar(item) && item.value === value) continue // already that number, as written
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

// ---- Save pose as… (Shift+P, Scene Actions…; docs/scene-files.md) ----------

/** null if `name` will do as a new pose's name, otherwise why not (nameProblem) */
export function poseNameProblem(name: string, existing: Iterable<string>): string | null {
  return nameProblem(name, existing, 'pose')
}

/** a pose as a q list: every joint, in order */
const qList = (q: number[]) => `[${q.join(', ')}]`

/**
 * The whole scene file with a new pose `name` added under `poses:` (which is
 * added if missing), as a list of every joint in `order`. Everything else
 * stays byte for byte.
 */
export function addNamedPose(source: string, name: string, q: number[], order: string[]): string {
  return addNamedEntry(source, 'poses', name, {
    block: (indent) => `${indent}${name}: ${qList(q)}\n`,
    flow: `${name}: ${qList(q)}`,
    comment: `   # radians, every joint in order: ${order.join(', ')}`,
  })
}

/** a new scene file for the engine scene `scene`, with the pose `name` (every joint in `order`) */
export function newPoseSceneFile(scene: string, name: string, q: number[], order: string[]): string {
  return (
    `# This lecture's version of the engine scene '${scene}', with named robot poses\n` +
    `# (docs/scene-files.md in the Lysark engine). A slide uses one with \`joints: ${name}\`.\n` +
    `base: ${scene}\n\nposes:   # radians, every joint in order: ${order.join(', ')}\n  ${name}: ${qList(q)}\n`
  )
}

/** what Save pose as… can do on a slide */
export interface PoseAsChoices {
  /** the scene the slide names in `scene:` */
  scene: string
  /** the engine scene it runs (its scene file's base), whose joints a pose sets */
  base: string
  /** its scene file, or where a new one goes */
  path: string
  /** the lecture has that scene file */
  exists: boolean
  /** the pose the slide names, if any */
  current: string | null
  /** the joints the slide sets itself: its own block's, or those of the pose it names */
  own: string[]
  /** the scene file's poses, with the joints each sets and the slides (0-based) whose robot it moves */
  poses: Array<{ name: string; joints: string[]; users: number[] }>
}

/**
 * The choices for slide `index` of `files['slides.md']` (the files the panel
 * shows); `users` gives the slides whose robot a pose moves (poseUsers, which
 * the runtime keeps per text). null if the slide has no scene.
 */
export function poseAsChoices(
  files: Record<string, string>,
  index: number,
  users: (target: PoseTarget) => number[],
): PoseAsChoices | null {
  const heads = slideHeads(files['slides.md'] ?? '')
  const head = heads[index]
  if (!head || typeof head.scene !== 'string') return null
  const scene = head.scene
  const path = [`scenes/${scene}.yaml`, `scenes/${scene}.yml`].find((p) => typeof files[p] === 'string')
  const block = head.joints !== null && typeof head.joints === 'object' && !Array.isArray(head.joints) ? Object.keys(head.joints) : []
  if (!path) return { scene, base: scene, path: `scenes/${scene}.yaml`, exists: false, current: null, own: block, poses: [] }
  const current = typeof head.joints === 'string' ? head.joints : null
  let file: SceneFile | undefined
  try {
    file = readSceneFiles({ [path]: files[path] }).get(scene)
  } catch {
    // a scene file with an error: no poses to offer; a new pose will say why
  }
  const naming = (pose: string) => heads.flatMap((h, i) => (h.scene === scene && h.joints === pose ? [i] : []))
  const poses = [...(file?.poses ?? [])].map(([name, pose]) => ({
    name,
    joints: Object.keys(pose.joints),
    users: users({ pose: name, path, users: naming(name) }),
  }))
  const own = current ? (poses.find((p) => p.name === current)?.joints ?? []) : block
  return { scene, base: file?.base ?? scene, path, exists: true, current, own, poses }
}

/** a Save pose as… choice: the slide alone, an existing pose, or a new pose */
export type SavePoseAs = { kind: 'slide' } | { kind: 'pose'; name: string } | { kind: 'new'; name: string }

/** the changes for a choice, and the joints they write (joint → radians) */
export interface PoseAsChanges {
  slides: Change | null
  scene: Change | null
  create: string | null
  written: Record<string, number>
}

/**
 * The changes that save the robot's pose by `choice` for slide `slide` of
 * `shown` (the slides.md the panel shows), computed on the files as they are
 * now in VS Code: `slides`, and the scene file's text (null if there is
 * none). `robot`: every joint as it would be written; `moved`: the joints P
 * writes. The slide keeps the pose it shows: what it set itself goes along.
 */
export function poseAsChanges(
  shown: string,
  current: { slides: string; scene: string | null },
  slide: number,
  choices: PoseAsChoices,
  choice: SavePoseAs,
  robot: Record<string, number>,
  moved: string[],
): PoseAsChanges | { problem: string } {
  const index = matchSlide(shown, current.slides, slide)
  if (index < 0) {
    return { problem: 'that slide has been edited since the preview last updated. Save the file (Ctrl+S), then try again.' }
  }
  const pick = (names: string[]) => Object.fromEntries([...new Set(names)].filter((n) => n in robot).map((n) => [n, robot[n]]))
  const order = sceneJoints(choices.base).map((j) => j.name)
  try {
    if (choice.kind === 'slide') {
      // a slide that names a pose gets a block with the pose's joints; one with joints of its own, P's edit
      const written = pick(choices.current ? [...choices.own, ...moved] : moved)
      const edited = Object.keys(written).length > 0 ? setSlideJoints(current.slides, index, written, true) : current.slides
      return { slides: singleEdit(current.slides, edited), scene: null, create: null, written }
    }
    // joints the slide sets that a pose of this scene can't hold (agilus-duo's
    // ghost_joint_*, or a misspelt one) would be lost with its block
    const extra = choices.current ? [] : choices.own.filter((n) => !order.includes(n))
    if (extra.length > 0) {
      return {
        problem:
          `this slide also sets ${extra.join(', ')}, which a pose of '${choices.base}' can't hold; ` +
          `save the pose into the slide itself (P, or 'Only this slide'), or move ${extra.length > 1 ? 'them' : 'it'} out of the slide by hand first`,
      }
    }
    const slides = singleEdit(current.slides, setSlideName(current.slides, index, 'joints', choice.name))
    if (choice.kind === 'pose') {
      if (current.scene === null) return { problem: `${choices.path} is gone; save the file (Ctrl+S) and try again` }
      const pose = choices.poses.find((p) => p.name === choice.name)
      const written = pick([...(pose?.joints ?? []), ...choices.own, ...moved])
      return { slides, scene: singleEdit(current.scene, setNamedPose(current.scene, choice.name, written, order)), create: null, written }
    }
    const problem = poseNameProblem(choice.name, choices.poses.map((p) => p.name))
    if (problem) return { problem }
    const written = pick(order)
    const q = order.map((n) => written[n])
    if (q.some((v) => v === undefined)) return { problem: `the robot shown doesn't have every joint of '${choices.base}'` }
    if (current.scene === null) return { slides, scene: null, create: newPoseSceneFile(choices.base, choice.name, q, order), written }
    return { slides, scene: singleEdit(current.scene, addNamedPose(current.scene, choice.name, q, order)), create: null, written }
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}
