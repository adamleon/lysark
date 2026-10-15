import { isMap, isScalar, isSeq, parseDocument, type Pair } from 'yaml'
import { slideRanges, splitLines } from '../compiler/slide-ranges'

/**
 * Write a saved camera view into one slide's frontmatter (lysark-v2.md §5,
 * "save a camera view"). Only the camera values change: every other line,
 * comment, and spacing in the file stays byte for byte, so git shows exactly
 * what changed. Pure function, shared by the VS Code extension and the tests.
 */

export type Vec3 = [number, number, number]

export interface CameraView {
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

/** the edit that sets an existing entry's value to `text`, written on the key's line */
function setValue(yaml: string, pair: Pair, text: string): Edit {
  const key = pair.key as { range: Range }
  const value = pair.value as { range?: Range; flow?: boolean } | null
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

  // no camera on this slide yet (or an empty `camera:`): add a block
  if (!cameraPair || (isScalar(cam) && cam.value === null)) {
    const block = ['camera:', ...(look ? [`  lookAt: ${look}`] : []), `  offset: ${offset}`].join('\n')
    if (cameraPair && isScalar(cameraPair.key) && cameraPair.key.range) {
      const start = cameraPair.key.range[0]
      const lineEnd = yaml.indexOf('\n', start)
      return yaml.slice(0, start) + block + (lineEnd < 0 ? '' : yaml.slice(lineEnd))
    }
    if (yaml.trim() === '') return block
    return yaml.replace(/\n*$/, '') + '\n' + block + (yaml.endsWith('\n') ? '\n' : '')
  }
  if (!isMap(cam) || !cam.range) throw new Error("this slide's camera is not a mapping")

  const pairOf = (name: string) => cam.items.find((p) => keyName(p as Pair) === name) as Pair | undefined
  const wanted: Array<[string, string]> = [...(look ? [['lookAt', look] as [string, string]] : []), ['offset', offset]]

  if (cam.flow && wanted.every(([name]) => pairOf(name)) && !pairOf('distance')) {
    // flow style with every value already there: splice the values, so a
    // comment between the braces survives
    return applyEdits(
      yaml,
      wanted.map(([name, text]) => setValue(yaml, pairOf(name)!, text)),
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
  for (const [name, text] of wanted) {
    const pair = pairOf(name)
    if (pair) edits.push(setValue(yaml, pair, text))
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
