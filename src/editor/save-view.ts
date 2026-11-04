import { parse as parseYaml } from 'yaml'
import { compileLecture } from '../compiler/compile-slides'
import { slideRanges, splitLines } from '../compiler/slide-ranges'
import { setCameraView, setNamedView, type CameraView } from './camera-edit'
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

/** each slide's own `scene:` and `camera:`, as written; [] if the text doesn't split into slides */
function slideHeads(text: string): Array<{ scene?: unknown; camera?: unknown }> {
  try {
    const lines = splitLines(text)
    return slideRanges(text).map((r) => {
      try {
        const fm = parseYaml(lines.slice(r.yamlStart, r.yamlEnd).join('\n')) as Record<string, unknown> | null
        return fm && typeof fm === 'object' ? { scene: fm.scene, camera: fm.camera } : {}
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
