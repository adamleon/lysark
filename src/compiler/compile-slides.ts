import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { parse as parseYaml } from 'yaml'
import { mergeCameraSpec } from '../engine/camera-merge'
import { PROFILES, type ProfileName } from '../engine/time-scaling'
import type {
  AnchoredSpec,
  CameraTargetSpec,
  CompiledSlide,
  IdleOsc,
  SlideTargets,
  TrajectorySpec,
  WidgetSpec,
} from '../engine/slide-types'

// single source of truth for valid profile names: the engine's profile registry
const PROFILE_NAMES = Object.keys(PROFILES)
const CURVE_SERIES = ['s', 'v', 'a']

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

/**
 * Plaintext title from the slide's first markdown heading, for the presenter
 * overview (§11). Strips emphasis/code/math markers so it is safe as text
 * content (never rendered as markup). Headings inside code fences are ignored.
 */
function extractTitle(body: string, fallback: string): string {
  let inFence = false
  for (const line of body.split('\n')) {
    if (FENCE.test(line.trimStart())) inFence = !inFence
    if (inFence) continue
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      const text = m[1].replace(/[*_`$]/g, '').replace(/\s+/g, ' ').trim()
      if (text) return text
    }
  }
  return fallback
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

/**
 * Render markdown with pre-rendered KaTeX. Code spans/fences are masked out
 * first so `$` and markdown inside them stay literal. `block: false` renders
 * inline (no wrapping `<p>`) for anchored labels (§4.2).
 */
function renderChunk(text: string, block: boolean): string {
  const code: string[] = []
  const maskCode = (s: string): string => {
    code.push(s)
    return `%%CODE_${code.length - 1}%%`
  }
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)?\1[ \t]*$/gm, maskCode)
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
  const html = block ? md.render(text) : md.renderInline(text)
  return html.replace(/%%MATH_(\d+)%%/g, (_, n: string) => rendered[Number(n)])
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

function isVec2(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber)
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateJoints(raw: unknown, slideNo: number): Record<string, number> {
  if (raw === undefined) return {}
  if (!isMapping(raw)) {
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
  if (!isMapping(raw)) {
    throw new Error(`slides: slide ${slideNo} 'camera' must be a mapping`)
  }
  const cam = raw
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
    if (!isMapping(cam.spring)) {
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

const PLOT_FIELDS = ['measured', 'setpoint', 'error']

function validateWidgets(raw: unknown, slideNo: number): WidgetSpec[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(`slides: slide ${slideNo} 'widgets' must be a list`)
  return (raw as unknown[]).map((entry) => {
    if (!isMapping(entry)) {
      throw new Error(`slides: slide ${slideNo} each widget must be a mapping`)
    }
    // these bind to no channel
    if (entry.type === 'curve') return validateCurve(entry, slideNo)
    if (entry.type === 'path') return validatePath(entry, slideNo)
    if (entry.type === 'toggle') return validateToggle(entry, slideNo)
    if (entry.type === 'transport') return validateTransport(entry, slideNo)
    if (entry.type === 'compare') return validateCompare(entry, slideNo)
    if (entry.type === 'jointgraph') return validateJointGraph(entry, slideNo)
    if (typeof entry.bind !== 'string' || entry.bind.length === 0) {
      throw new Error(`slides: widget on slide ${slideNo} is missing 'bind'`)
    }
    if (entry.type === 'slider') return validateSlider(entry, slideNo)
    if (entry.type === 'plot') return validatePlot(entry, slideNo)
    throw new Error(`slides: unknown widget type '${String(entry.type)}' on slide ${slideNo} (supports: slider, plot, curve, path, toggle, transport, compare)`)
  })
}

function validatePath(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} path widget has unknown key '${key}'`)
    }
  }
  return { type: 'path', ...(w.label !== undefined ? { label: w.label as string } : {}) }
}

function validateToggle(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'labels', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} toggle widget has unknown key '${key}'`)
    }
  }
  if (
    !Array.isArray(w.labels) ||
    w.labels.length !== 2 ||
    !w.labels.every((l) => typeof l === 'string' && l.length > 0)
  ) {
    throw new Error(`slides: slide ${slideNo} toggle 'labels' must be a list of exactly two names`)
  }
  return {
    type: 'toggle',
    labels: w.labels as [string, string],
    ...(w.label !== undefined ? { label: w.label as string } : {}),
  }
}

function validateTransport(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} transport widget has unknown key '${key}'`)
    }
  }
  return { type: 'transport', ...(w.label !== undefined ? { label: w.label as string } : {}) }
}

function validateJointGraph(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} jointgraph widget has unknown key '${key}'`)
    }
  }
  return { type: 'jointgraph', ...(w.label !== undefined ? { label: w.label as string } : {}) }
}

function validateCompare(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'profiles', 'labels', 'quantities', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} compare widget has unknown key '${key}'`)
    }
  }
  if (
    !Array.isArray(w.profiles) ||
    w.profiles.length !== 2 ||
    !w.profiles.every((p) => typeof p === 'string' && PROFILE_NAMES.includes(p))
  ) {
    throw new Error(`slides: slide ${slideNo} compare 'profiles' must be two of ${PROFILE_NAMES.join(', ')}`)
  }
  if (
    !Array.isArray(w.labels) ||
    w.labels.length !== 2 ||
    !w.labels.every((l) => typeof l === 'string' && l.length > 0)
  ) {
    throw new Error(`slides: slide ${slideNo} compare 'labels' must be two names`)
  }
  let quantities = ['s', 'v', 'a']
  if (w.quantities !== undefined) {
    if (!Array.isArray(w.quantities) || w.quantities.length === 0 || !w.quantities.every((q) => CURVE_SERIES.includes(q as string))) {
      throw new Error(`slides: slide ${slideNo} compare 'quantities' must be a non-empty list of ${CURVE_SERIES.join(', ')}`)
    }
    quantities = w.quantities as string[]
  }
  return {
    type: 'compare',
    profiles: w.profiles as [ProfileName, ProfileName],
    labels: w.labels as [string, string],
    quantities: quantities as ('s' | 'v' | 'a')[],
    ...(w.label !== undefined ? { label: w.label as string } : {}),
  }
}

function validateCurve(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'profile', 'show', 'label'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} curve widget has unknown key '${key}'`)
    }
  }
  if (typeof w.profile !== 'string' || !PROFILE_NAMES.includes(w.profile)) {
    throw new Error(`slides: slide ${slideNo} curve profile must be one of ${PROFILE_NAMES.join(', ')}`)
  }
  let show = ['s', 'v', 'a']
  if (w.show !== undefined) {
    if (!Array.isArray(w.show) || w.show.length === 0 || !w.show.every((s) => CURVE_SERIES.includes(s as string))) {
      throw new Error(`slides: slide ${slideNo} curve 'show' must be a non-empty list of ${CURVE_SERIES.join(', ')}`)
    }
    show = w.show as string[]
  }
  return {
    type: 'curve',
    profile: w.profile as ProfileName,
    show: show as ('s' | 'v' | 'a')[],
    ...(w.label !== undefined ? { label: w.label as string } : {}),
  }
}

function validateSlider(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'bind', 'label', 'range', 'pid'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} slider widget has unknown key '${key}'`)
    }
  }
  if (w.range !== undefined && !isVec2(w.range)) {
    throw new Error(`slides: slide ${slideNo} widget range must be [min, max]`)
  }
  if (w.pid !== undefined) {
    if (!isMapping(w.pid)) throw new Error(`slides: slide ${slideNo} widget pid must be a mapping`)
    for (const [key, value] of Object.entries(w.pid)) {
      if (!['kp', 'ki', 'kd'].includes(key) || !isFiniteNumber(value) || value < 0) {
        throw new Error(`slides: slide ${slideNo} widget pid.${key} must be a non-negative number`)
      }
    }
  }
  return w as unknown as WidgetSpec
}

function validatePlot(w: Record<string, unknown>, slideNo: number): WidgetSpec {
  for (const key of Object.keys(w)) {
    if (!['type', 'bind', 'label', 'range', 'window'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} plot widget has unknown key '${key}'`)
    }
  }
  const dot = (w.bind as string).indexOf('.')
  if (dot !== -1) {
    const field = (w.bind as string).slice(dot + 1)
    if (!PLOT_FIELDS.includes(field)) {
      throw new Error(`slides: slide ${slideNo} plot bind field '.${field}' must be one of ${PLOT_FIELDS.join(', ')}`)
    }
  }
  if (w.range !== undefined && !isVec2(w.range)) {
    throw new Error(`slides: slide ${slideNo} plot range must be [min, max]`)
  }
  if (w.window !== undefined && (!isFiniteNumber(w.window) || w.window <= 0)) {
    throw new Error(`slides: slide ${slideNo} plot window must be a positive number of seconds`)
  }
  return {
    type: 'plot',
    bind: w.bind as string,
    ...(w.label !== undefined ? { label: w.label as string } : {}),
    ...(w.range !== undefined ? { range: w.range as [number, number] } : {}),
    window: (w.window as number | undefined) ?? 6,
  }
}

function validateAnchored(raw: unknown, slideNo: number): AnchoredSpec[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(`slides: slide ${slideNo} 'anchored' must be a list`)
  return (raw as unknown[]).map((entry): AnchoredSpec => {
    if (!isMapping(entry)) {
      throw new Error(`slides: slide ${slideNo} each anchored element must be a mapping`)
    }
    for (const key of Object.keys(entry)) {
      if (!['anchor', 'offset', 'content', 'vector'].includes(key)) {
        throw new Error(`slides: slide ${slideNo} anchored element has unknown key '${key}'`)
      }
    }
    if (typeof entry.anchor !== 'string' || entry.anchor.length === 0) {
      throw new Error(`slides: slide ${slideNo} anchored element needs an 'anchor' node name`)
    }
    let offset: [number, number] = [0, 0]
    if (entry.offset !== undefined) {
      if (!isVec2(entry.offset)) {
        throw new Error(`slides: slide ${slideNo} anchored offset must be [dx, dy] pixels`)
      }
      offset = entry.offset
    }
    if ((entry.content !== undefined) === (entry.vector !== undefined)) {
      throw new Error(
        `slides: slide ${slideNo} anchored element '${entry.anchor}' must declare exactly one of 'content' or 'vector'`,
      )
    }
    if (entry.content !== undefined) {
      if (typeof entry.content !== 'string' || entry.content.length === 0) {
        throw new Error(`slides: slide ${slideNo} anchored element '${entry.anchor}' needs 'content'`)
      }
      return { kind: 'label', anchor: entry.anchor, offset, html: renderChunk(entry.content, false) }
    }
    return { ...validateAnchoredVector(entry.vector, entry.anchor, slideNo), anchor: entry.anchor, offset }
  })
}

function validateAnchoredVector(
  raw: unknown,
  anchor: string,
  slideNo: number,
): { kind: 'vector'; symbolHtml: string; channels: string[]; digits: number } {
  if (!isMapping(raw)) {
    throw new Error(`slides: slide ${slideNo} anchored '${anchor}' vector must be a mapping`)
  }
  for (const key of Object.keys(raw)) {
    if (!['symbol', 'joints', 'digits'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} anchored '${anchor}' vector has unknown key '${key}'`)
    }
  }
  const symbol = raw.symbol === undefined ? 'q' : raw.symbol
  if (typeof symbol !== 'string' || symbol.length === 0) {
    throw new Error(`slides: slide ${slideNo} anchored '${anchor}' vector symbol must be a non-empty string`)
  }
  if (
    !Array.isArray(raw.joints) ||
    raw.joints.length === 0 ||
    !raw.joints.every((j) => typeof j === 'string' && j.length > 0)
  ) {
    throw new Error(`slides: slide ${slideNo} anchored '${anchor}' vector needs a non-empty 'joints' list of channel names`)
  }
  let digits = 2
  if (raw.digits !== undefined) {
    if (!isFiniteNumber(raw.digits) || raw.digits < 0 || !Number.isInteger(raw.digits)) {
      throw new Error(`slides: slide ${slideNo} anchored '${anchor}' vector digits must be a non-negative integer`)
    }
    digits = raw.digits
  }
  // `$symbol =$` gives the leading term the same KaTeX typography as body math
  return { kind: 'vector', symbolHtml: renderChunk(`$${symbol} =$`, false), channels: raw.joints as string[], digits }
}

function validateIdle(raw: unknown, slideNo: number): Record<string, IdleOsc> | undefined {
  if (raw === undefined) return undefined
  if (!isMapping(raw)) {
    throw new Error(`slides: slide ${slideNo} 'idle' must be a mapping of channel → { amp, freq }`)
  }
  const out: Record<string, IdleOsc> = {}
  for (const [name, spec] of Object.entries(raw)) {
    if (!isMapping(spec)) {
      throw new Error(`slides: slide ${slideNo} idle channel '${name}' must be a mapping`)
    }
    for (const key of Object.keys(spec)) {
      if (!['amp', 'freq', 'phase', 'center'].includes(key)) {
        throw new Error(`slides: slide ${slideNo} idle channel '${name}' has unknown key '${key}'`)
      }
    }
    if (!isFiniteNumber(spec.amp) || spec.amp < 0) {
      throw new Error(`slides: slide ${slideNo} idle '${name}' amp must be a non-negative number`)
    }
    if (!isFiniteNumber(spec.freq) || spec.freq <= 0) {
      throw new Error(`slides: slide ${slideNo} idle '${name}' freq must be a positive number`)
    }
    if (spec.phase !== undefined && !isFiniteNumber(spec.phase)) {
      throw new Error(`slides: slide ${slideNo} idle '${name}' phase must be a number`)
    }
    if (spec.center !== undefined && !isFiniteNumber(spec.center)) {
      throw new Error(`slides: slide ${slideNo} idle '${name}' center must be a number`)
    }
    out[name] = {
      amp: spec.amp,
      freq: spec.freq,
      phase: (spec.phase as number | undefined) ?? 0,
      ...(spec.center !== undefined ? { center: spec.center as number } : {}),
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function validatePose(raw: unknown, slideNo: number, which: string): Record<string, number> {
  if (!isMapping(raw)) {
    throw new Error(`slides: slide ${slideNo} trajectory '${which}' must be a mapping of joint → number`)
  }
  const keys = Object.keys(raw)
  if (keys.length === 0) {
    throw new Error(`slides: slide ${slideNo} trajectory '${which}' needs at least one joint`)
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!isFiniteNumber(value)) {
      throw new Error(`slides: slide ${slideNo} trajectory ${which}.${name} must be a finite number`)
    }
  }
  return raw as Record<string, number>
}

function validateTrajectory(raw: unknown, slideNo: number): TrajectorySpec | undefined {
  if (raw === undefined) return undefined
  if (!isMapping(raw)) {
    throw new Error(`slides: slide ${slideNo} 'trajectory' must be a mapping`)
  }
  for (const key of Object.keys(raw)) {
    if (!['from', 'to', 'control', 'profile', 'compare', 'space', 'trace', 'duration', 'dwell'].includes(key)) {
      throw new Error(`slides: slide ${slideNo} trajectory has unknown key '${key}'`)
    }
  }
  const from = validatePose(raw.from, slideNo, 'from')
  const to = validatePose(raw.to, slideNo, 'to')
  // every q₀ joint must have a q_f value and vice versa — a partial pose is a typo
  for (const name of Object.keys(from)) {
    if (!(name in to)) throw new Error(`slides: slide ${slideNo} trajectory joint '${name}' is in 'from' but not 'to'`)
  }
  for (const name of Object.keys(to)) {
    if (!(name in from)) throw new Error(`slides: slide ${slideNo} trajectory joint '${name}' is in 'to' but not 'from'`)
  }

  const control = raw.control === undefined ? 'auto' : raw.control
  if (control !== 'auto' && control !== 'slider' && control !== 'time') {
    throw new Error(`slides: slide ${slideNo} trajectory control must be 'auto', 'slider' or 'time'`)
  }

  // profile/duration matter when time drives s (auto/time); defaulted for slider
  let profile = 'cubic'
  if (raw.profile !== undefined) {
    if (typeof raw.profile !== 'string' || !PROFILE_NAMES.includes(raw.profile)) {
      throw new Error(`slides: slide ${slideNo} trajectory profile must be one of ${PROFILE_NAMES.join(', ')}`)
    }
    profile = raw.profile
  } else if (control !== 'slider') {
    throw new Error(`slides: slide ${slideNo} ${control} trajectory needs a 'profile'`)
  }

  let duration = 1
  if (raw.duration !== undefined) {
    if (!isFiniteNumber(raw.duration) || raw.duration <= 0) {
      throw new Error(`slides: slide ${slideNo} trajectory 'duration' must be a positive number of seconds`)
    }
    duration = raw.duration
  } else if (control !== 'slider') {
    throw new Error(`slides: slide ${slideNo} ${control} trajectory needs a 'duration'`)
  }

  let dwell = 0.5
  if (raw.dwell !== undefined) {
    if (!isFiniteNumber(raw.dwell) || raw.dwell < 0) {
      throw new Error(`slides: slide ${slideNo} trajectory 'dwell' must be a non-negative number`)
    }
    dwell = raw.dwell
  }

  let compare: string | undefined
  if (raw.compare !== undefined) {
    if (typeof raw.compare !== 'string' || !PROFILE_NAMES.includes(raw.compare)) {
      throw new Error(`slides: slide ${slideNo} trajectory compare must be one of ${PROFILE_NAMES.join(', ')}`)
    }
    compare = raw.compare
  }

  const space = raw.space === undefined ? 'joint' : raw.space
  if (space !== 'joint' && space !== 'task') {
    throw new Error(`slides: slide ${slideNo} trajectory space must be 'joint' or 'task'`)
  }

  let trace: ('joint' | 'task')[] = []
  if (raw.trace !== undefined) {
    if (!Array.isArray(raw.trace) || !raw.trace.every((t) => t === 'joint' || t === 'task')) {
      throw new Error(`slides: slide ${slideNo} trajectory trace must be a list of 'joint' and/or 'task'`)
    }
    trace = raw.trace as ('joint' | 'task')[]
  }

  return {
    from,
    to,
    control,
    space,
    trace,
    profile: profile as ProfileName,
    ...(compare ? { compare: compare as ProfileName } : {}),
    duration,
    dwell,
  }
}

// ---------------------------------------------------------------------------

export function compileSlides(source: string): CompiledSlide[] {
  const raw = splitSlides(source)
  const out: CompiledSlide[] = []
  // A scene may span more than one run as long as only scene-less slides sit
  // between the runs — the runtime suspends the scene on the way out and restores
  // its serialized state on re-entry (§4.1). What stays forbidden is interleaving
  // two DIFFERENT scenes: once another scene has run, the previous one is "sealed"
  // and may not reappear (§3), since that would demand two scenes' state be juggled
  // across the gap rather than one scene's suspend/restore.
  const sealedScenes = new Set<string>()
  let lastRealScene: string | undefined
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
        if (sealedScenes.has(scene)) {
          throw new Error(`slides: scene '${scene}' reused non-contiguously at slide ${slideNo} — another scene ran since its last slide; a scene's runs may only be separated by scene-less slides (spec §3, §4.1)`)
        }
        // a different real scene starting here seals whichever real scene ran last
        if (lastRealScene !== undefined && lastRealScene !== scene) {
          sealedScenes.add(lastRealScene)
        }
        lastRealScene = scene
      }
      joints = {}
      camera = undefined
      currentScene = scene
      inDeck = true
    }

    const widgets = validateWidgets(frontmatter.widgets, slideNo)

    let effective: SlideTargets = {}
    let anchored: AnchoredSpec[] = []
    let idle: Record<string, IdleOsc> | undefined
    let trajectory: TrajectorySpec | undefined
    if (scene === undefined) {
      // scene-less slides carry overlay content only (spec §3)
      if (
        frontmatter.joints !== undefined ||
        frontmatter.camera !== undefined ||
        widgets.length > 0 ||
        frontmatter.anchored !== undefined ||
        frontmatter.idle !== undefined ||
        frontmatter.trajectory !== undefined
      ) {
        throw new Error(`slides: scene-less slide ${slideNo} cannot declare joints, camera, widgets, anchored, idle, or trajectory (spec §3)`)
      }
    } else {
      Object.assign(joints, validateJoints(frontmatter.joints, slideNo))
      camera = mergeCameraSpec(camera, validateCamera(frontmatter.camera, slideNo))
      effective = { joints: { ...joints } }
      if (camera) effective.camera = structuredClone(camera)
      anchored = validateAnchored(frontmatter.anchored, slideNo)
      idle = validateIdle(frontmatter.idle, slideNo)
      trajectory = validateTrajectory(frontmatter.trajectory, slideNo)
    }

    const fragments = splitFragments(body)
      .map((chunk) => renderChunk(chunk.trim(), true))
      .filter((html) => html.length > 0)

    const id = (frontmatter.id as string | undefined) ?? `slide-${slideNo}`
    out.push({
      id,
      title: extractTitle(body, id),
      scene,
      layout:
        frontmatter.layout === 'center' || frontmatter.layout === 'graph'
          ? frontmatter.layout
          : 'panel',
      effective,
      widgets,
      anchored,
      ...(idle ? { idle } : {}),
      ...(trajectory ? { trajectory } : {}),
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
