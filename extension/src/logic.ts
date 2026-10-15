/**
 * The extension's pure parts, kept apart from the vscode API so the engine's
 * tests can run them.
 */

import { slideRanges, splitLines } from '../../src/compiler/slide-ranges'

/**
 * What identifies each slide across edits: its `id:` and its body text. Not the
 * rest of the frontmatter, which a saved view changes. null if the text doesn't
 * split into slides.
 */
function slideSignatures(text: string): string[] | null {
  try {
    const lines = splitLines(text)
    return slideRanges(text).map((r) => {
      const id = lines.slice(r.yamlStart, r.yamlEnd).find((l) => /^id\s*:/.test(l)) ?? ''
      return `${id.trim()}\n${lines.slice(r.bodyStart, r.bodyEnd).join('\n').trim()}`
    })
  } catch {
    return null
  }
}

/**
 * The slide in text `to` that is slide `index` of text `from` (both 0-based):
 * the same number if that slide is unchanged, otherwise the nearest slide
 * that matches it, so slides added or removed elsewhere don't matter. -1 if
 * no slide matches, for example when the slide itself was edited.
 */
export function matchSlide(from: string, to: string, index: number): number {
  if (from === to) return index
  const a = slideSignatures(from)
  const b = slideSignatures(to)
  if (!a || !b || index < 0 || index >= a.length) return -1
  const wanted = a[index]
  for (let d = 0; d < Math.max(index + 1, b.length - index); d++) {
    if (b[index - d] === wanted) return index - d
    if (b[index + d] === wanted) return index + d
  }
  return -1
}

/** the folder the course site publishes the editor runtime in (scripts/site.mjs) */
export const EDITOR_PATH = '_lysark/editor/'

/**
 * Where to load the editor runtime from: the `lysark.editorUrl` setting if set,
 * otherwise the course package.json's `homepage` (its GitHub Pages address)
 * plus `_lysark/editor/`. Throws with a message for the author if neither works.
 */
export function editorUrl(setting: string, packageJson: unknown): string {
  const fromSetting = setting.trim()
  if (fromSetting) return checkedUrl(fromSetting, 'The lysark.editorUrl setting')
  const homepage = (packageJson as { homepage?: unknown } | null)?.homepage
  if (typeof homepage !== 'string' || !homepage.trim()) {
    throw new Error(
      "The course's package.json has no \"homepage\". Add the course's GitHub Pages address, " +
        'for example "homepage": "https://adamleon.github.io/ais2105-lectures/".',
    )
  }
  const base = checkedUrl(homepage.trim(), 'The "homepage" in package.json')
  return new URL(EDITOR_PATH, base.endsWith('/') ? base : `${base}/`).href
}

function checkedUrl(text: string, what: string): string {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error(`${what} is not a web address: ${text}`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    throw new Error(`${what} must start with https:// (got ${text})`)
  }
  return url.href
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/** a saved view as the runtime sends it: lookAt is a point or an anchor name */
export function isCameraView(v: unknown): v is { lookAt: [number, number, number] | string; offset: [number, number, number] } {
  const view = v as { lookAt?: unknown; offset?: unknown } | null
  return !!view && typeof view === 'object' && isVec3(view.offset) && (typeof view.lookAt === 'string' || isVec3(view.lookAt))
}

/** true if package.json belongs to a Lysark course (it depends on the engine) */
export function isCoursePackage(packageJson: unknown): boolean {
  const deps = (packageJson as { dependencies?: Record<string, unknown> } | null)?.dependencies
  return !!deps && typeof deps === 'object' && 'lysark' in deps
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
  while (
    tail < max - start &&
    oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
  ) {
    tail++
  }
  return { start, end: oldText.length - tail, text: newText.slice(start, newText.length - tail) }
}
