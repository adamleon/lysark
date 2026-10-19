import { slideRanges, splitLines } from '../compiler/slide-ranges'

/**
 * Finding the same slide in two versions of slides.md, and the smallest edit
 * between two texts. The panel runtime uses both to write a saved view into the
 * current text (src/editor/save-view.ts); the extension uses matchSlide to
 * follow the cursor, and both for the older message version 2.
 */

interface Signature {
  /** what identifies a slide across edits: its `id:` and its body text, not the frontmatter a saved view changes */
  loose: string
  /** the whole frontmatter, and the frontmatter without `camera:`: to tell same-looking slides apart */
  frontmatter: string
  withoutCamera: string
}

/** the frontmatter lines without a top-level key and the lines indented under it */
function withoutKey(yaml: string[], key: string): string[] {
  const out: string[] = []
  let skipping = false
  for (const line of yaml) {
    if (line.startsWith(key) && /^\s*:/.test(line.slice(key.length))) {
      skipping = true
      continue
    }
    if (skipping && (line.trim() === '' || /^\s/.test(line))) continue
    skipping = false
    out.push(line)
  }
  return out
}

/** each slide's signature; null if the text doesn't split into slides */
function slideSignatures(text: string): Signature[] | null {
  try {
    const lines = splitLines(text)
    return slideRanges(text).map((r) => {
      const yaml = lines.slice(r.yamlStart, r.yamlEnd)
      const id = yaml.find((l) => /^id\s*:/.test(l)) ?? ''
      return {
        loose: `${id.trim()}\n${lines.slice(r.bodyStart, r.bodyEnd).join('\n').trim()}`,
        frontmatter: yaml.join('\n'),
        withoutCamera: withoutKey(yaml, 'camera').join('\n'),
      }
    })
  } catch {
    return null
  }
}

/**
 * The slide in text `to` that is slide `index` of text `from` (both 0-based),
 * found by its `id:` and text, so slides added, removed or moved elsewhere
 * don't matter. Slides that look the same (no `id:`, the same text) are told
 * apart by their frontmatter (scene, camera); failing that, they keep their
 * order, if there are as many of them as before. -1 if no slide matches (the
 * slide itself was edited), or if which one is meant is unclear.
 */
export function matchSlide(from: string, to: string, index: number): number {
  if (from === to) return index
  const a = slideSignatures(from)
  const b = slideSignatures(to)
  if (!a || !b || index < 0 || index >= a.length) return -1
  const wanted = a[index]
  const alike = (s: Signature) => s.loose === wanted.loose
  const before = a.filter(alike)
  const now = b.flatMap((s, i) => (alike(s) ? [i] : []))
  if (now.length === 1 && before.length === 1) return now[0]
  // the one slide with the same frontmatter (or the same apart from its camera), in both texts
  const unique = (s: Signature): number | null => {
    for (const key of ['frontmatter', 'withoutCamera'] as const) {
      const exact = now.filter((i) => b[i][key] === s[key])
      if (exact.length === 1 && before.filter((t) => t[key] === s[key]).length === 1) return exact[0]
    }
    return null
  }
  const found = unique(wanted)
  if (found !== null) return found
  // otherwise by order, if there are as many as before, and unless that slide
  // is the one another of them was found to be (two slides can't be one)
  if (now.length !== before.length) return -1
  const target = now[a.slice(0, index).filter(alike).length]
  return before.some((s) => s !== wanted && unique(s) === target) ? -1 : target
}

/**
 * The one replacement that turns oldText into newText: everything outside it is
 * unchanged. Applying this instead of replacing the whole file keeps the
 * cursor, folding, and undo history around the edit.
 */
export function singleEdit(oldText: string, newText: string): { start: number; end: number; text: string } | null {
  if (oldText === newText) return null
  let start = 0
  const max = Math.min(oldText.length, newText.length)
  while (start < max && oldText[start] === newText[start]) start++
  let tail = 0
  while (tail < max - start && oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]) {
    tail++
  }
  return { start, end: oldText.length - tail, text: newText.slice(start, newText.length - tail) }
}
