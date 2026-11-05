import { isMap, isScalar, isSeq, parseDocument, stringify, type Pair, type YAMLMap } from 'yaml'
import { slideRanges, splitLines } from '../compiler/slide-ranges'

/**
 * Write a saved camera view into one slide's frontmatter (lysark-v2.md §5,
 * "save a camera view"), or into a named view in a scene file
 * (docs/scene-files.md). Only the camera values change: every other line,
 * comment, and spacing in the file stays byte for byte, so git shows exactly
 * what changed. Pure functions, shared by the panel, the VS Code extension
 * (for message version 2) and the tests.
 */

export type Vec3 = [number, number, number]

export interface CameraView {
  /** how the camera flies there; written into a new named view (Save view as…), not otherwise */
  spring?: { omega?: number; zeta?: number }
  /** a point, or the name of an anchor the slide already looks at (kept as is) */
  lookAt: Vec3 | string
  /** camera position relative to the look point */
  offset: Vec3
}

const round = (n: number) => Number(n.toFixed(2))
export const formatVec = (v: Vec3) => `[${v.map(round).join(', ')}]`

interface Edit {
  start: number
  end: number
  text: string
}

function lineStart(src: string, at: number): number {
  return src.lastIndexOf('\n', at - 1) + 1
}

function keyName(p: Pair): unknown {
  return isScalar(p.key) ? p.key.value : undefined
}

type Range = [number, number, number]

/**
 * The edits that set an existing entry's value to `text` (`numbers`, as a
 * list), written on the key's line. A list written one item per line keeps
 * its form and its comments: each number is replaced where it stands.
 */
function setValue(yaml: string, pair: Pair, text: string, numbers?: number[]): Edit[] {
  const key = pair.key as { range: Range }
  const value = pair.value as { range?: Range; flow?: boolean } | null
  if (isSeq(value) && !value.flow && numbers && value.items.length === numbers.length) {
    const items = value.items as Array<{ range?: Range; value?: unknown }>
    // a tag (`!!int`) or an anchor (`&a`) on an item would apply to the new number: rewrite the list then
    const plain = (item: { tag?: string; anchor?: string }) => !item.tag && !item.anchor
    if (items.every((item) => isScalar(item) && typeof item.value === 'number' && plain(item) && item.range)) {
      return items.map((item, k) => ({ start: item.range![0], end: item.range![1], text: String(round(numbers[k])) }))
    }
  }
  return [setWhole(yaml, key, value, text)]
}

function setWhole(yaml: string, key: { range: Range }, value: { range?: Range; flow?: boolean } | null, text: string): Edit {
  if ((isSeq(value) || isMap(value)) && !value.flow && value.range) {
    // `lookAt:` followed by `- 1` lines: replace from the key to the last item
    // (the value's range runs on past its trailing newline)
    let end = value.range[1]
    while (end > key.range[1] && /\s/.test(yaml[end - 1])) end--
    return { start: key.range[1], end, text: `: ${text}` }
  }
  if (value?.range && value.range[1] > value.range[0]) return { start: value.range[0], end: value.range[1], text }
  // an empty value (`offset:`): write it after the colon, keeping any comment
  const colon = yaml.indexOf(':', key.range[1])
  return { start: key.range[1], end: colon + 1, text: `: ${text}` }
}

function applyEdits(yaml: string, edits: Edit[]): string {
  let out = yaml
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** the camera edit for one slide's YAML (without its `---` fences) */
export function editCameraYaml(yaml: string, view: CameraView): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) {
    throw new Error(`this slide's frontmatter has a YAML error, so the view can't be saved: ${doc.errors[0].message}`)
  }
  const root = doc.contents
  if (root !== null && !isMap(root)) throw new Error("this slide's frontmatter is not a YAML mapping")
  const look = typeof view.lookAt === 'string' ? null : formatVec(view.lookAt)
  const offset = formatVec(view.offset)

  const cameraPair = root?.items.find((p) => keyName(p as Pair) === 'camera') as Pair | undefined
  const cam = cameraPair?.value

  // no camera on this slide yet, an empty `camera:`, or the name of a view
  // (`camera: oversikt`, "only this slide"): a block of its own
  if (!cameraPair || (isScalar(cam) && (cam.value === null || typeof cam.value === 'string'))) {
    // in place of a view's name the block is the whole camera, an anchor
    // included: a block merges with what the slide carries, the view didn't
    const named = isScalar(cam) && typeof cam.value === 'string'
    const lookAt = look ?? (named ? yamlScalar(view.lookAt as string) : null)
    const block = ['camera:', ...(lookAt ? [`  lookAt: ${lookAt}`] : []), `  offset: ${offset}`].join('\n')
    if (cameraPair && isScalar(cameraPair.key) && cameraPair.key.range) {
      const start = cameraPair.key.range[0]
      // to the end of the line holding the value's last character (a name may
      // be written on the next line, or as a block scalar)
      let valueEnd = isScalar(cam) && cam.range ? cam.range[1] : start
      while (valueEnd > start && /\s/.test(yaml[valueEnd - 1])) valueEnd--
      const lineEnd = yaml.indexOf('\n', Math.max(start, valueEnd))
      return yaml.slice(0, start) + block + (lineEnd < 0 ? '' : yaml.slice(lineEnd))
    }
    if (yaml.trim() === '') return block
    return yaml.replace(/\n*$/, '') + '\n' + block + (yaml.endsWith('\n') ? '\n' : '')
  }
  if (!isMap(cam) || !cam.range) throw new Error("this slide's camera is not a mapping")
  return editCameraMapping(yaml, cam, view)
}

/**
 * The edit to one camera mapping (a slide's `camera:`, or a named view) in
 * `yaml`: lookAt (unless it is an anchor kept as is) and offset set, a
 * `distance` dropped, everything else as written.
 */
function editCameraMapping(yaml: string, cam: YAMLMap<unknown, unknown>, view: CameraView): string {
  if (!cam.range) throw new Error('the camera has no position in the text')
  const pairOf = (name: string) => cam.items.find((p) => keyName(p as Pair) === name) as Pair | undefined
  // an anchor is left as it stands where the mapping already looks at it, or
  // has no lookAt (it carries it); any other lookAt (a point, another anchor,
  // as in another view) is replaced by it
  const written = pairOf('lookAt')?.value
  const keepAnchor =
    typeof view.lookAt === 'string' && (written === undefined || (isScalar(written) && written.value === view.lookAt))
  const look = typeof view.lookAt !== 'string' ? formatVec(view.lookAt) : keepAnchor ? null : yamlScalar(view.lookAt)
  const offset = formatVec(view.offset)
  const wanted: Array<[string, string, number[] | undefined]> = [
    ...(look ? [['lookAt', look, typeof view.lookAt === 'string' ? undefined : view.lookAt] as [string, string, number[] | undefined]] : []),
    ['offset', offset, view.offset],
  ]

  if (cam.flow && wanted.every(([name]) => pairOf(name)) && !pairOf('distance')) {
    // flow style with every value already there: splice the values, so a
    // comment between the braces survives
    return applyEdits(
      yaml,
      wanted.flatMap(([name, text, numbers]) => setValue(yaml, pairOf(name)!, text, numbers)),
    )
  }
  if (cam.flow) {
    // flow style `{ lookAt: [...], offset: [...] }` that lacks a value or has a
    // distance: rebuild the braces, keeping every other entry's text exactly as
    // written (a comment between the braces is lost)
    const others = cam.items
      .filter((p) => !['lookAt', 'offset', 'distance'].includes(String(keyName(p as Pair))))
      .filter((p) => !(look === null && keyName(p as Pair) === 'lookAt'))
      .map((p) => {
        const k = (p as Pair).key as { range?: [number, number, number] }
        const v = (p as Pair).value as { range?: [number, number, number] } | null
        return yaml.slice(k.range![0], (v?.range ?? k.range!)[1])
      })
    const keepLook = look === null ? pairOf('lookAt') : undefined
    const keptLook = keepLook
      ? [yaml.slice((keepLook.key as { range: number[] }).range[0], (keepLook.value as { range: number[] }).range[1])]
      : []
    const entries = [...keptLook, ...wanted.map(([k, v]) => `${k}: ${v}`), ...others]
    return yaml.slice(0, cam.range[0]) + `{ ${entries.join(', ')} }` + yaml.slice(cam.range[1])
  }

  // block style: replace values in place, add missing keys, drop `distance`
  // (an alternative to offset that the compiler refuses next to it)
  const edits: Edit[] = []
  const firstKey = cam.items[0]?.key as { range?: [number, number, number] } | undefined
  const indent = firstKey?.range ? ' '.repeat(firstKey.range[0] - lineStart(yaml, firstKey.range[0])) : '  '
  const missing: string[] = []
  for (const [name, text, numbers] of wanted) {
    const pair = pairOf(name)
    if (pair) edits.push(...setValue(yaml, pair, text, numbers))
    else missing.push(`${indent}${name}: ${text}\n`)
  }
  const distance = pairOf('distance')
  if (distance) {
    const key = distance.key as { range: [number, number, number] }
    const value = (distance.value as { range?: [number, number, number] } | null)?.range ?? key.range
    const nl = yaml.indexOf('\n', value[1])
    const start = lineStart(yaml, key.range[0])
    // the last line has no newline after it: take the one before it instead
    edits.push(nl < 0 ? { start: Math.max(0, start - 1), end: yaml.length, text: '' } : { start, end: nl + 1, text: '' })
  }
  if (missing.length > 0) {
    const at = cam.range[1]
    let text = (at > 0 && yaml[at - 1] !== '\n' ? '\n' : '') + missing.join('')
    if (at === yaml.length) text = text.replace(/\n$/, '') // nothing follows: no trailing newline
    edits.push({ start: at, end: at, text })
  }
  return applyEdits(yaml, edits)
}

/**
 * The whole scene file with the view written into its named view `name`
 * (`views: { name: { lookAt, offset, … } }`), which must exist. Line endings
 * and a byte-order mark are kept.
 */
export function setNamedView(source: string, name: string, view: CameraView): string {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const crlf = source.includes('\r\n')
  const yaml = (bom ? source.slice(1) : source).replace(/\r\n/g, '\n')
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) throw new Error(`the scene file has a YAML error, so the view can't be saved: ${doc.errors[0].message}`)
  const views = doc.get('views', true)
  const cam = isMap(views) ? views.get(name, true) : undefined
  if (!isMap(cam)) throw new Error(`the scene file has no view '${name}' to save into`)
  const edited = editCameraMapping(yaml, cam as YAMLMap<unknown, unknown>, view)
  return bom + (crlf ? edited.replace(/\n/g, '\r\n') : edited)
}

/** the whole slides.md with the view written into slide `slideIndex` (0-based) */
export function setCameraView(source: string, slideIndex: number, view: CameraView): string {
  const ranges = slideRanges(source)
  const r = ranges[slideIndex]
  if (!r) throw new Error(`there is no slide ${slideIndex + 1}`)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const lines = splitLines(source)
  const yaml = lines.slice(r.yamlStart, r.yamlEnd).join('\n')
  const edited = editCameraYaml(yaml, view)
  const yamlLines = edited === '' ? [] : edited.split('\n')
  return bom + [...lines.slice(0, r.yamlStart), ...yamlLines, ...lines.slice(r.yamlEnd)].join(eol)
}

// ---- named views (docs/scene-files.md): using one on a slide, adding one --------

/** the YAML text of a file, without a byte-order mark and with \n line endings, and how to put them back */
function plainText(source: string): { yaml: string; restore: (text: string) => string } {
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const crlf = source.includes('\r\n')
  return {
    yaml: (bom ? source.slice(1) : source).replace(/\r\n/g, '\n'),
    restore: (text) => bom + (crlf ? text.replace(/\n/g, '\r\n') : text),
  }
}

const RESERVED = /^(true|false|null|yes|no|on|off|y|n)$/i

/** `text` as YAML that reads back as the same string: bare when it can be, quoted when not */
function yamlScalar(text: string): string {
  return stringify(text, { lineWidth: 0 }).trimEnd()
}

/**
 * null if `name` will do as a new view's name, otherwise why not. One word, so
 * it is written without quotes in both files: letters (Norwegian ones too),
 * digits, - and _, starting with a letter.
 */
export function viewNameProblem(name: string, existing: Iterable<string>): string | null {
  if (name.trim() === '') return "write a name for the view, such as 'oversikt'"
  if (!/^\p{L}[\p{L}\p{N}_-]*$/u.test(name)) {
    return "a view's name is one word: letters (æ, ø and å too), digits, - and _, starting with a letter"
  }
  if (RESERVED.test(name)) return `'${name}' reads as a value in YAML; choose another name`
  for (const other of existing) if (other === name) return `there is already a view called '${name}'`
  return null
}

/**
 * The whole slides.md with slide `slideIndex` (0-based) using the view `name`:
 * its `camera:` (a block of its own, or another name) becomes `camera: name`,
 * or the line is added. Everything else stays byte for byte.
 */
export function setCameraName(source: string, slideIndex: number, name: string): string {
  const r = slideRanges(source)[slideIndex]
  if (!r) throw new Error(`there is no slide ${slideIndex + 1}`)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const lines = splitLines(source)
  const yaml = lines.slice(r.yamlStart, r.yamlEnd).join('\n')
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) throw new Error(`this slide's frontmatter has a YAML error: ${doc.errors[0].message}`)
  const root = doc.contents
  if (root !== null && !isMap(root)) throw new Error("this slide's frontmatter is not a YAML mapping")
  const pair = root?.items.find((p) => keyName(p as Pair) === 'camera') as Pair | undefined
  let edited: string
  const key = pair?.key as { range?: Range } | undefined
  if (pair && key?.range) {
    const start = key.range[0]
    const value = pair.value as { range?: Range } | null
    let end: number
    if (value?.range && value.range[1] > value.range[0]) {
      // to the value's last character (a block mapping's range runs on past its newline)
      end = value.range[1]
      while (end > start && /\s/.test(yaml[end - 1])) end--
    } else {
      end = yaml.indexOf('\n', start)
      if (end < 0) end = yaml.length
    }
    edited = yaml.slice(0, start) + `camera: ${yamlScalar(name)}` + yaml.slice(end)
  } else {
    const line = `camera: ${yamlScalar(name)}`
    edited = yaml.trim() === '' ? line : yaml.replace(/\n*$/, '') + `\n${line}` + (yaml.endsWith('\n') ? '\n' : '')
  }
  return bom + [...lines.slice(0, r.yamlStart), ...edited.split('\n'), ...lines.slice(r.yamlEnd)].join(eol)
}

/** the lookAt and offset of a view as written in a scene file, and its spring if it has one */
function viewValues(view: CameraView): { look: string; offset: string; spring: string | null } {
  const parts = Object.entries(view.spring ?? {})
    .filter(([key, value]) => (key === 'omega' || key === 'zeta') && typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => `${key}: ${Number((value as number).toFixed(3))}`)
  return {
    look: typeof view.lookAt === 'string' ? yamlScalar(view.lookAt) : formatVec(view.lookAt),
    offset: formatVec(view.offset),
    spring: parts.length > 0 ? `{ ${parts.join(', ')} }` : null,
  }
}

/**
 * The whole scene file with a new view `name` added under `views:` (which is
 * added if missing), written like the views already there. Everything else
 * stays byte for byte.
 */
export function addNamedView(source: string, name: string, view: CameraView): string {
  const { yaml, restore } = plainText(source)
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) throw new Error(`the scene file has a YAML error, so the view can't be added: ${doc.errors[0].message}`)
  const root = doc.contents
  if (!isMap(root)) throw new Error('the scene file is not a YAML mapping')
  const { look, offset, spring } = viewValues(view)
  const block = (indent: string, inner: string) =>
    `${indent}${name}:\n${indent}${inner}lookAt: ${look}\n${indent}${inner}offset: ${offset}\n` +
    (spring ? `${indent}${inner}spring: ${spring}\n` : '')
  const viewsPair = root.items.find((p) => keyName(p as Pair) === 'views') as Pair | undefined
  const v = viewsPair?.value as (YAMLMap<unknown, unknown> & { range?: Range }) | { value?: unknown; range?: Range } | null | undefined

  if (!viewsPair) {
    return restore(`${yaml.replace(/\n*$/, '\n')}\nviews:\n${block('  ', '  ')}`)
  }
  if (v === null || v === undefined || (isScalar(v) && v.value === null)) {
    // `views:` with nothing under it (or `~`, `null`, which go): right after that line
    let text = yaml
    const empty = v as { range?: Range } | null
    if (empty?.range && empty.range[1] > empty.range[0]) {
      let from = empty.range[0]
      while (from > 0 && text[from - 1] === ' ') from--
      text = text.slice(0, from) + text.slice(empty.range[1])
    }
    const start = (viewsPair.key as { range: Range }).range[0]
    const lineEnd = text.indexOf('\n', start)
    if (lineEnd < 0) return restore(`${text}\n${block('  ', '  ')}`)
    return restore(text.slice(0, lineEnd + 1) + block('  ', '  ') + text.slice(lineEnd + 1))
  }
  if (!isMap(v)) throw new Error("the scene file's 'views' is not a mapping of names to views")
  if (v.items.some((p) => keyName(p as Pair) === name)) throw new Error(`the scene file already has a view '${name}'`)
  if (v.flow) {
    // `views: { a: { … } }`: one more entry before the closing brace
    const entry = `${name}: { lookAt: ${look}, offset: ${offset}${spring ? `, spring: ${spring}` : ''} }`
    if (v.items.length === 0) return restore(yaml.slice(0, v.range![0]) + `{ ${entry} }` + yaml.slice(v.range![1]))
    const last = v.items[v.items.length - 1] as Pair
    const at = ((last.value as { range?: Range } | null)?.range ?? (last.key as { range: Range }).range)[1]
    return restore(yaml.slice(0, at) + `, ${entry}` + yaml.slice(at))
  }
  // block style: after the last view, indented as the others
  const firstKey = (v.items[0] as Pair).key as { range: Range }
  const indent = ' '.repeat(firstKey.range[0] - lineStart(yaml, firstKey.range[0]))
  const firstView = (v.items[0] as Pair).value
  const innerKey = isMap(firstView) && !firstView.flow ? ((firstView.items[0] as Pair | undefined)?.key as { range?: Range } | undefined) : undefined
  const inner = innerKey?.range ? ' '.repeat(Math.max(1, innerKey.range[0] - lineStart(yaml, innerKey.range[0]) - indent.length)) : '  '
  const last = v.items[v.items.length - 1] as Pair
  // the node's end (range[2]) takes in comment lines indented under the last
  // view, which belong to it; the new view goes after them
  let end = ((last.value as { range?: Range } | null)?.range ?? (last.key as { range: Range }).range)[2]
  while (end > 0 && /\s/.test(yaml[end - 1])) end--
  const lineEnd = yaml.indexOf('\n', end)
  if (lineEnd < 0) return restore(`${yaml}\n${block(indent, inner)}`)
  return restore(yaml.slice(0, lineEnd + 1) + block(indent, inner) + yaml.slice(lineEnd + 1))
}

/** a new scene file for the engine scene `scene`, with the view `name` */
export function newSceneFile(scene: string, name: string, view: CameraView): string {
  const { look, offset, spring } = viewValues(view)
  return (
    `# This lecture's version of the engine scene '${scene}', with named camera views\n` +
    `# (docs/scene-files.md in the Lysark engine). A slide uses one with \`camera: ${name}\`.\n` +
    `base: ${scene}\n\nviews:\n  ${name}:\n    lookAt: ${look}\n    offset: ${offset}\n` +
    (spring ? `    spring: ${spring}\n` : '')
  )
}
