import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { parse as parseYaml } from 'yaml'
import { mergeCameraSpec } from '../engine/camera-merge'
import type {
  CameraTargetSpec,
  CompiledSlide,
  SlideTargets,
  WidgetSpec,
} from '../engine/slide-types'

/**
 * Build-time slide compiler (spec §8): markdown + YAML frontmatter →
 * CompiledSlide[]. Runs in the Vite plugin and in tests — never in the
 * browser, so markdown-it/yaml/katex stay out of the runtime bundle.
 *
 * Authoring rules enforced here:
 * - Slides are separated by frontmatter blocks (`---` fences). `---` inside
 *   fenced code blocks is fine; use `***` for a horizontal rule in prose.
 * - `<!-- pause -->` on its own line (outside code fences) splits the body
 *   into fragments (§4.3).
 * - `$…$` / `$$…$$` are KaTeX, pre-rendered here. `$` inside code spans and
 *   fenced blocks is left alone. For a literal `$` in prose, escape as `\$`.
 * - A scene spans one contiguous slide range (§3): non-contiguous reuse of a
 *   scene id is a compile error, effective targets reset at every scene
 *   boundary (§4.3), and scene-less slides carry overlay content only.
 */

const md = new MarkdownIt({ html: true })

const FENCE = /^(?:`{3,}|~{3,})/
const PAUSE_LINE = /^<!--\s*pause\s*-->\s*$/

interface RawSlide {
  frontmatter: Record<string, unknown>
  body: string
}

function splitSlides(source: string): RawSlide[] {
  const lines = source
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  // tolerate trailing whitespace on fences — the classic invisible authoring error
  const isSep = (line: string) => line.trimEnd() === '---'
  const slides: RawSlide[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    if (!isSep(lines[i])) {
      throw new Error(`slides: expected '---' frontmatter fence at line ${i + 1}, got: ${lines[i]}`)
    }
    const yamlStart = ++i
    while (i < lines.length && !isSep(lines[i])) i++
    if (i >= lines.length) throw new Error('slides: unterminated frontmatter block')
    const yamlText = lines.slice(yamlStart, i).join('\n')
    i++ // skip closing fence
    const bodyStart = i
    let inFence = false
    while (i < lines.length && !(isSep(lines[i]) && !inFence)) {
      if (FENCE.test(lines[i].trimStart())) inFence = !inFence
      i++
    }
    const body = lines.slice(bodyStart, i).join('\n')
    const frontmatter = parseYaml(yamlText) ?? {}
    if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      throw new Error(`slides: frontmatter of slide ${slides.length + 1} must be a YAML mapping`)
    }
    slides.push({ frontmatter: frontmatter as Record<string, unknown>, body })
  }
  return slides
}

/** fragment split on <!-- pause --> lines, ignoring markers inside code fences */
function splitFragments(body: string): string[] {
  const chunks: string[][] = [[]]
  let inFence = false
  for (const line of body.split('\n')) {
    if (FENCE.test(line.trimStart())) inFence = !inFence
    if (!inFence && PAUSE_LINE.test(line)) {
      chunks.push([])
      continue
    }
    chunks[chunks.length - 1].push(line)
  }
  return chunks.map((c) => c.join('\n'))
}

/** pre-render math before markdown; code spans/fences are masked out first */
function renderWithMath(chunk: string): string {
  const code: string[] = []
  const maskCode = (s: string): string => {
    code.push(s)
    return `%%CODE_${code.length - 1}%%`
  }
  let text = chunk.replace(
    /^(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)?\1[ \t]*$/gm,
    maskCode,
  )
  text = text.replace(/`[^`\n]+`/g, maskCode)

  const rendered: string[] = []
  const stash = (tex: string, displayMode: boolean): string => {
    rendered.push(katex.renderToString(tex, { displayMode, throwOnError: false }))
    return `%%MATH_${rendered.length - 1}%%`
  }
  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => stash(tex, true))
    .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex: string) => stash(tex, false))
    .replace(/\\\$/g, '$')
  // restore code before markdown render so it renders as normal code
  text = text.replace(/%%CODE_(\d+)%%/g, (_, n: string) => code[Number(n)])
  return md.render(text).replace(/%%MATH_(\d+)%%/g, (_, n: string) => rendered[Number(n)])
}

// ---------------------------------------------------------------------------
// Frontmatter validation — the schema is the contract (spec §8), so values
// that pass YAML but break the schema fail loudly at build time.
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
}

function validateJoints(raw: unknown, slideNo: number): Record<string, number> {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`slides: slide ${slideNo} 'joints' must be a mapping of joint → number`)
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!isFiniteNumber(value)) {
      throw new Error(`slides: slide ${slideNo} joint '${name}' must be a finite number, got ${JSON.stringify(value)}`)
    }
  }
  return raw as Record<string, number>
}

function validateCamera(raw: unknown, slideNo: number): CameraTargetSpec | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`slides: slide ${slideNo} 'camera' must be a mapping`)
  }
  const cam = raw as Record<string, unknown>
  for (const key of Object.keys(cam)) {
    if (!['lookAt', 'offset', 'distance', 'spring'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} camera has unknown key '${key}'`)
    }
  }
  if (cam.lookAt !== undefined && typeof cam.lookAt !== 'string' && !isVec3(cam.lookAt)) {
    throw new Error(`slides: slide ${slideNo} camera.lookAt must be an anchor name or [x, y, z]`)
  }
  if (cam.offset !== undefined && !isVec3(cam.offset)) {
    throw new Error(`slides: slide ${slideNo} camera.offset must be [x, y, z] finite numbers`)
  }
  if (cam.distance !== undefined && (!isFiniteNumber(cam.distance) || cam.distance <= 0)) {
    throw new Error(`slides: slide ${slideNo} camera.distance must be a positive number`)
  }
  if (cam.offset !== undefined && cam.distance !== undefined) {
    throw new Error(`slides: slide ${slideNo} camera declares both offset and distance — they are alternative framings, pick one`)
  }
  if (cam.spring !== undefined) {
    if (typeof cam.spring !== 'object' || cam.spring === null || Array.isArray(cam.spring)) {
      throw new Error(`slides: slide ${slideNo} camera.spring must be a mapping`)
    }
    for (const [key, value] of Object.entries(cam.spring)) {
      if (!['omega', 'zeta'].includes(key) || !isFiniteNumber(value) || value <= 0) {
        throw new Error(`slides: slide ${slideNo} camera.spring.${key} must be a positive number`)
      }
    }
  }
  return cam as CameraTargetSpec
}

function validateWidgets(raw: unknown, slideNo: number): WidgetSpec[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(`slides: slide ${slideNo} 'widgets' must be a list`)
  for (const w of raw as Array<Record<string, unknown>>) {
    if (w.type !== 'slider') {
      throw new Error(`slides: unknown widget type '${String(w.type)}' on slide ${slideNo} (M3 supports: slider)`)
    }
    if (typeof w.bind !== 'string' || w.bind.length === 0) {
      throw new Error(`slides: widget on slide ${slideNo} is missing 'bind'`)
    }
    if (w.range !== undefined && !(Array.isArray(w.range) && w.range.length === 2 && w.range.every(isFiniteNumber))) {
      throw new Error(`slides: slide ${slideNo} widget range must be [min, max]`)
    }
    if (w.pid !== undefined) {
      for (const [key, value] of Object.entries(w.pid as Record<string, unknown>)) {
        if (!['kp', 'ki', 'kd'].includes(key) || !isFiniteNumber(value) || value < 0) {
          throw new Error(`slides: slide ${slideNo} widget pid.${key} must be a non-negative number`)
        }
      }
    }
  }
  return raw as WidgetSpec[]
}

// ---------------------------------------------------------------------------

export function compileSlides(source: string): CompiledSlide[] {
  const raw = splitSlides(source)
  const out: CompiledSlide[] = []
  const seenScenes = new Set<string>()
  let currentScene: string | undefined
  let inDeck = false
  let joints: Record<string, number> = {}
  let camera: CameraTargetSpec | undefined

  raw.forEach(({ frontmatter, body }, index) => {
    const slideNo = index + 1
    if (frontmatter.scene !== undefined && typeof frontmatter.scene !== 'string') {
      throw new Error(`slides: slide ${slideNo} 'scene' must be a string`)
    }
    if (frontmatter.id !== undefined && typeof frontmatter.id !== 'string') {
      throw new Error(`slides: slide ${slideNo} 'id' must be a string`)
    }
    const scene = frontmatter.scene as string | undefined

    if (!inDeck || scene !== currentScene) {
      // scene-run boundary (§3): targets never leak across it (§4.3, §4.1)
      if (scene !== undefined) {
        if (seenScenes.has(scene)) {
          throw new Error(`slides: scene '${scene}' reused non-contiguously at slide ${slideNo} — a scene spans one contiguous range (spec §3)`)
        }
        seenScenes.add(scene)
      }
      joints = {}
      camera = undefined
      currentScene = scene
      inDeck = true
    }

    const widgets = validateWidgets(frontmatter.widgets, slideNo)

    let effective: SlideTargets = {}
    if (scene === undefined) {
      // scene-less slides carry overlay content only (spec §3)
      if (frontmatter.joints !== undefined || frontmatter.camera !== undefined || widgets.length > 0) {
        throw new Error(`slides: scene-less slide ${slideNo} cannot declare joints, camera, or widgets (spec §3)`)
      }
    } else {
      Object.assign(joints, validateJoints(frontmatter.joints, slideNo))
      camera = mergeCameraSpec(camera, validateCamera(frontmatter.camera, slideNo))
      effective = { joints: { ...joints } }
      if (camera) effective.camera = structuredClone(camera)
    }

    const fragments = splitFragments(body)
      .map((chunk) => renderWithMath(chunk.trim()))
      .filter((html) => html.length > 0)

    out.push({
      id: (frontmatter.id as string | undefined) ?? `slide-${slideNo}`,
      scene,
      layout: frontmatter.layout === 'center' ? 'center' : 'panel',
      effective,
      widgets,
      fragments: fragments.length > 0 ? fragments : [''],
    })
  })

  const ids = new Set<string>()
  for (const slide of out) {
    if (ids.has(slide.id)) throw new Error(`slides: duplicate slide id '${slide.id}'`)
    ids.add(slide.id)
  }
  return out
}
