import { parse as parseYaml } from 'yaml'
import { compileLecture } from '../compiler/compile-slides'
import { readSceneFiles } from '../compiler/scene-files'
import { slideRanges, splitLines } from '../compiler/slide-ranges'
import { addNamedView, newSceneFile, setCameraName, setCameraView, setNamedView, viewNameProblem, type CameraView } from './camera-edit'
import { matchSlide, singleEdit } from './slide-match'

/**
 * The text edits that save a camera view, computed in the panel (messages
 * version 3, docs/editor-host.md): into the slide's own frontmatter, or, on a
 * slide that names a view (`camera: overview`), into that view in the scene
 * file (docs/scene-files.md).
 */

type Change = { start: number; end: number; text: string }

/**
 * The edit that writes the view into slide `slide` of `shown` (the text the
 * panel shows), applied to `current`, the file as it is now in VS Code,
 * unsaved typing included. Only the camera values change. null if the view
 * is already there.
 */
export function viewEdit(shown: string, current: string, slide: number, view: CameraView): Change | null | { problem: string } {
  const index = matchSlide(shown, current, slide)
  if (index < 0) {
    return {
      problem: 'that slide has been edited since the preview last updated. Save the file (Ctrl+S), then save the view again.',
    }
  }
  let next: string
  try {
    next = setCameraView(current, index, view)
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
  return singleEdit(current, next)
}

/** the edit that writes the view into the named view `name` of a scene file's text; null if already there */
export function namedViewEdit(sceneText: string, name: string, view: CameraView): Change | null | { problem: string } {
  try {
    return singleEdit(sceneText, setNamedView(sceneText, name, view))
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}

/** each slide's own `scene:`, `camera:` and `joints:`, as written; [] if the text doesn't split into slides */
export function slideHeads(text: string): Array<{ scene?: unknown; camera?: unknown; joints?: unknown }> {
  try {
    const lines = splitLines(text)
    return slideRanges(text).map((r) => {
      try {
        const fm = parseYaml(lines.slice(r.yamlStart, r.yamlEnd).join('\n')) as Record<string, unknown> | null
        return fm && typeof fm === 'object' ? { scene: fm.scene, camera: fm.camera, joints: fm.joints } : {}
      } catch {
        return {}
      }
    })
  } catch {
    return []
  }
}

/** where V writes for a slide that names a view: the view, its scene file, and the slides that name it */
export interface NamedTarget {
  view: string
  /** `scenes/<scene>.yaml` (or `.yml`), as in `files` */
  path: string
  /** the slides (0-based) whose own `camera:` names this view */
  users: number[]
}

/**
 * The slides (0-based) whose camera comes from the named view, any part of it:
 * those that name it and those that carry it on, found by compiling with the
 * view moved. `cameras`: each slide's camera as the files compile now (the
 * running deck has them), so only one compile is needed. The slides that name
 * it if the files don't compile.
 */
export function viewUsers(files: Record<string, string>, target: NamedTarget, cameras: unknown[]): number[] {
  try {
    const moved = setNamedView(files[target.path], target.view, { lookAt: [12345.6, 0, 0], offset: [0, 12345.6, 0] })
    const now = compileLecture(files['slides.md'], { ...files, [target.path]: moved }).slides
    return now.flatMap((s, i) => (JSON.stringify(s.effective.camera) !== JSON.stringify(cameras[i]) ? [i] : []))
  } catch {
    return target.users
  }
}

/**
 * Where V writes for slide `index` of the text `files['slides.md']`: the
 * named view the slide names, in the lecture's scene file for its scene; null
 * if the slide has its own camera values, or none (V then writes into the
 * slide).
 */
export function namedTarget(files: Record<string, string>, index: number): NamedTarget | null {
  const heads = slideHeads(files['slides.md'] ?? '')
  const head = heads[index]
  if (!head || typeof head.camera !== 'string' || typeof head.scene !== 'string') return null
  const path = [`scenes/${head.scene}.yaml`, `scenes/${head.scene}.yml`].find((p) => typeof files[p] === 'string')
  if (!path) return null
  const users = heads.flatMap((h, i) => (h.scene === head.scene && h.camera === head.camera ? [i] : []))
  return { view: head.camera, path, users }
}

// ---- Save view as… (Shift+V, docs/scene-files.md) ---------------------------------

/** what Save view as… can do on a slide */
export interface SaveAsChoices {
  /** the scene the slide names in `scene:` */
  scene: string
  /** its scene file, or where a new one goes */
  path: string
  /** the lecture has that scene file */
  exists: boolean
  /** the view the slide names, if any */
  current: string | null
  /** the scene file's views, with the slides (0-based) that fly to each */
  views: Array<{ name: string; users: number[] }>
}

/**
 * The choices for slide `index` of `files['slides.md']` (the files the panel
 * shows); `users` gives the slides that fly to a view (viewUsers, which the
 * runtime keeps per text). null if the slide has no scene.
 */
export function saveAsChoices(
  files: Record<string, string>,
  index: number,
  users: (target: NamedTarget) => number[],
): SaveAsChoices | null {
  const head = slideHeads(files['slides.md'] ?? '')[index]
  if (!head || typeof head.scene !== 'string') return null
  const scene = head.scene
  const path = [`scenes/${scene}.yaml`, `scenes/${scene}.yml`].find((p) => typeof files[p] === 'string')
  const current = typeof head.camera === 'string' ? head.camera : null
  if (!path) return { scene, path: `scenes/${scene}.yaml`, exists: false, current: null, views: [] }
  let names: string[] = []
  try {
    names = [...(readSceneFiles({ [path]: files[path] }).get(scene)?.views.keys() ?? [])]
  } catch {
    // a scene file with an error: no views to offer; a new view will say why
  }
  return { scene, path, exists: true, current, views: names.map((name) => ({ name, users: users({ view: name, path, users: [] }) })) }
}

/** a Save view as… choice: the slide alone, an existing view, or a new view */
export type SaveAs = { kind: 'slide' } | { kind: 'view'; name: string } | { kind: 'new'; name: string }

/** the changes for a choice: to slides.md, and to the scene file, or the scene file to create */
export interface SaveAsChanges {
  slides: Change | null
  scene: Change | null
  create: string | null
}

/**
 * The changes that save `view` by `choice` for slide `slide` of `shown` (the
 * slides.md the panel shows), computed on the files as they are now in VS
 * Code: `slides`, and the scene file's text (null if there is none).
 */
export function saveAsChanges(
  shown: string,
  current: { slides: string; scene: string | null },
  slide: number,
  choices: SaveAsChoices,
  choice: SaveAs,
  view: CameraView,
): SaveAsChanges | { problem: string } {
  const index = matchSlide(shown, current.slides, slide)
  if (index < 0) {
    return { problem: 'that slide has been edited since the preview last updated. Save the file (Ctrl+S), then try again.' }
  }
  try {
    if (choice.kind === 'slide') {
      return { slides: singleEdit(current.slides, setCameraView(current.slides, index, view)), scene: null, create: null }
    }
    const slides = singleEdit(current.slides, setCameraName(current.slides, index, choice.name))
    if (choice.kind === 'view') {
      if (current.scene === null) return { problem: `${choices.path} is gone; save the file (Ctrl+S) and try again` }
      return { slides, scene: singleEdit(current.scene, setNamedView(current.scene, choice.name, view)), create: null }
    }
    const names = choices.views.map((v) => v.name)
    const problem = viewNameProblem(choice.name, names)
    if (problem) return { problem }
    if (current.scene === null) return { slides, scene: null, create: newSceneFile(choices.scene, choice.name, view) }
    return { slides, scene: singleEdit(current.scene, addNamedView(current.scene, choice.name, view)), create: null }
  } catch (err) {
    return { problem: String((err as Error)?.message ?? err) }
  }
}
