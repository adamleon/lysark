/**
 * Finding one's way in a lecture's slides.md in VS Code
 * (docs/slide-navigation.md): where each slide's settings block is, for
 * folding the blocks and for leaving them out of the text VS Code's Markdown
 * outline is made from, and the label on each slide's first line. Kept apart
 * from the vscode API so the engine's tests can run it.
 *
 * A settings block runs from a slide's opening `---` line to its closing
 * `---` line, found by the compiler's own rules (src/compiler/slide-ranges.ts).
 * While the author is typing, the text may not split into slides; see
 * SlideTracker for what counts then.
 *
 * Line numbers are 0-based and count lines as VS Code does, with \n or \r\n.
 */
import { slideRanges, splitLines, type SlideRange } from '../../src/compiler/slide-ranges'

/** a code fence, as src/compiler/slide-ranges.ts has it: a `---` inside one is body text */
const FENCE = /^(?:`{3,}|~{3,})/
const isSep = (line: string) => line.trimEnd() === '---'

export interface Block {
  /** the slide's opening `---` line */
  open: number
  /** its closing `---` line */
  close: number
}

export interface SlideBlock extends Block {
  /** the slide's `id:`, if its settings have one */
  id: string | null
}

/** what a document's text holds, for the plugin, the folding and the separators */
export interface Settings {
  blocks: SlideBlock[]
  /**
   * lone `---` lines while a slide is half typed: blanked for the outline,
   * since the compiler would read each as a slide's first line, never as
   * body text; not folded, not labelled
   */
  strays: number[]
}

/** a file the extension treats as a lecture's slides, by its path: `lectures/<name>/slides.md`, as the lysark command finds lectures */
export function isLecturePath(path: string): boolean {
  return /\/lectures\/[^/]+\/slides\.md$/.test(path)
}

/** the compiler's slides, or null if the text doesn't split into slides */
function rangesOf(text: string): SlideRange[] | null {
  try {
    return slideRanges(text)
  } catch {
    return null
  }
}

const blockOf = (r: SlideRange): Block => ({ open: r.fenceLine, close: r.yamlEnd })

/** the blocks by the compiler's rules, or null if the text doesn't split into slides */
export function splitBlocks(text: string): Block[] | null {
  return rangesOf(text)?.map(blockOf) ?? null
}

/**
 * Whether a text that splits into slides, but without some of the earlier
 * blocks (`carried`), is a slide or a code block half typed rather than an
 * edit that made those blocks body text: a `---` line of an earlier block
 * that changed sides (an opening line that now closes a block, or a closing
 * line that now opens one), as when a new slide's opening `---` pairs with
 * the next slide's; or a last body that ends inside an open code fence, as
 * when an opening fence typed into a body swallows the slides after it. A
 * finished edit that makes a block body text, such as a code fence put around
 * a slide to show it as an example, does neither.
 */
export function halfTyped(lines: string[], ranges: SlideRange[], carried: Block[]): boolean {
  const opens = new Set(ranges.map((r) => r.fenceLine))
  const closes = new Set(ranges.map((r) => r.yamlEnd))
  if (carried.some((c) => closes.has(c.open) || opens.has(c.close))) return true
  const last = ranges.at(-1)
  let inFence = false
  if (last) for (let k = last.bodyStart; k < last.bodyEnd; k++) if (FENCE.test(lines[k].trimStart())) inFence = !inFence
  return inFence
}

/**
 * The blocks of an earlier text that split into slides, found again in
 * `lines` where they still stand, line for line the same: at the same line
 * (above the typing) or moved by the change in line count (below it). A block
 * the typing changed, or that moved otherwise, is left out.
 */
export function carriedBlocks(before: { lines: string[]; blocks: Block[] }, lines: string[]): Block[] {
  const delta = lines.length - before.lines.length
  const unchanged = (from: number, to: number, at: number) => {
    if (at < 0 || at + (to - from) >= lines.length) return false
    for (let k = 0; k <= to - from; k++) if (lines[at + k] !== before.lines[from + k]) return false
    return true
  }
  const carried: Block[] = []
  let next = 0
  for (const { open, close } of before.blocks) {
    const at = [open, open + delta].find((line) => line >= next && unchanged(open, close, line))
    if (at === undefined) continue
    carried.push({ open: at, close: at + close - open })
    next = at + close - open + 1
  }
  return carried
}

/**
 * The `---` lines outside the blocks and outside fenced code blocks (whose
 * state starts afresh after each block, as in slideRanges' bodies). By the
 * compiler's rules each is a slide's opening line.
 */
export function strayFences(lines: string[], blocks: Block[]): number[] {
  const strays: number[] = []
  let b = 0
  let inFence = false
  for (let k = 0; k < lines.length; k++) {
    if (b < blocks.length && k === blocks[b].open) {
      k = blocks[b++].close
      inFence = false
    } else if (FENCE.test(lines[k].trimStart())) inFence = !inFence
    else if (isSep(lines[k]) && !inFence) strays.push(k)
  }
  return strays
}

/** the value of the first top-level `id:` line in lines [from, to), or null */
function idIn(lines: string[], from: number, to: number): string | null {
  for (let k = from; k < to; k++) {
    const m = /^id:(?:[ \t]+(.*))?$/.exec(lines[k].trimEnd())
    if (!m) continue
    const raw = (m[1] ?? '').trim()
    // a quoted value as it is; a plain one up to a comment
    const quoted = /^(["'])(.*)\1(?:[ \t]+#.*)?$/.exec(raw)
    const value = quoted ? quoted[2] : raw.replace(/(?:^|[ \t]+)#.*$/, '').trim()
    return value || null
  }
  return null
}

function withIds(lines: string[], blocks: Block[]): SlideBlock[] {
  return blocks.map((b) => ({ ...b, id: idIn(lines, b.open + 1, b.close) }))
}

/** each slide's settings block in a text on its own, by the compiler's rules; none if the text doesn't split into slides */
export function slideBlocks(text: string): SlideBlock[] {
  return withIds(splitLines(text), splitBlocks(text) ?? [])
}

/**
 * The settings blocks of one document as it changes.
 *
 * A text that splits into slides by the compiler's rules has the compiler's
 * blocks; that is what the preview shows. Halfway through typing a new slide
 * the text often doesn't split, or splits wrongly: its opening `---` pairs
 * with the next slide's, every body after it reads as settings, and an
 * opening code fence typed into a body swallows the slides after it. So
 * once a document has split, a text that doesn't, or whose split lacks one
 * of the earlier blocks that still stands unchanged (carriedBlocks) in a
 * way typing halfway does (halfTyped), gets those earlier blocks, and its
 * lone `---` lines as strays, until it splits again.
 *
 * A document that doesn't split when first seen (a half-typed slide restored
 * when VS Code reopens, or text before the first `---`) is left as it is
 * until it splits: no rule tells its bodies from its settings.
 */
export class SlideTracker {
  /** the last text that split into slides, with its blocks */
  private last: { lines: string[]; blocks: Block[] } | null = null
  private seen: { text: string; settings: Settings } | null = null
  /**
   * whether the document had a settings block to fold when first seen. VS Code
   * folds every block of the kind Imports the first time it has some to fold
   * in an editor; in a document opened without one, that would be the first
   * block the author types, with the cursor in it (navigation.ts).
   */
  foldsOnOpen: boolean | null = null

  settings(text: string): Settings {
    if (this.seen?.text === text) return this.seen.settings
    const lines = splitLines(text)
    const ranges = rangesOf(text)
    const split = ranges?.map(blockOf) ?? []
    const carried = this.last ? carriedBlocks(this.last, lines) : []
    const lacking = (b: Block) => !split.some((s) => s.open === b.open && s.close === b.close)
    let settings: Settings
    if (ranges && (!carried.some(lacking) || !halfTyped(lines, ranges, carried))) {
      this.last = { lines, blocks: split }
      settings = { blocks: withIds(lines, split), strays: [] }
    } else if (this.last) {
      settings = { blocks: withIds(lines, carried), strays: strayFences(lines, carried) }
    } else {
      settings = { blocks: [], strays: [] }
    }
    this.foldsOnOpen ??= foldingBlocks(settings.blocks).length > 0
    this.seen = { text, settings }
    return settings
  }
}

/** the text on a slide's first line: `slide 3 · pid-control`, or `slide 3` without an id */
export function slideLabel(index: number, id: string | null): string {
  return id ? `slide ${index + 1} · ${id}` : `slide ${index + 1}`
}

/** each slide's opening `---` line and its label */
export function separators(blocks: SlideBlock[]): Array<{ line: number; label: string }> {
  return blocks.map((b, k) => ({ line: b.open, label: slideLabel(k, b.id) }))
}

/**
 * The settings blocks to fold, from opening to closing `---` line: those with
 * at least one line of settings (an empty block has nothing to hide).
 */
export function foldingBlocks(blocks: Block[]): Array<{ start: number; end: number }> {
  return blocks.flatMap((b) => (b.close > b.open + 1 ? [{ start: b.open, end: b.close }] : []))
}

/**
 * The text with the settings blocks blanked, for VS Code's Markdown parse:
 * each line from a slide's opening `---` to its closing `---` becomes empty,
 * and so does each stray `---`, keeping its line ending, so the lines keep
 * their numbers.
 */
export function blankSettings(text: string, blocks: Block[], strays: number[] = []): string {
  if (blocks.length === 0 && strays.length === 0) return text
  // the same lines as splitLines, each with its \r if it has one (and the first with a BOM)
  const lines = text.split('\n')
  const blank = (k: number) => {
    lines[k] = lines[k].endsWith('\r') ? '\r' : ''
  }
  for (const { open, close } of blocks) for (let k = open; k <= close; k++) blank(k)
  for (const k of strays) blank(k)
  return lines.join('\n')
}

/**
 * What Lysark: Fold or Unfold Slide Settings does, from the blocks and the
 * editor's visible ranges (VS Code leaves a folded block's lines after its
 * first out of them): fold every block if one in sight has its settings
 * open; otherwise open every block if one in sight is folded; with neither
 * to go by (no block in sight, or only an opening line at the bottom), the
 * opposite of what the command did last, and open the first time, since the
 * blocks fold when the file opens.
 */
export function toggleAction(
  blocks: Array<{ start: number; end: number }>,
  visible: Array<{ start: number; end: number }>,
  last: 'fold' | 'unfold' | null,
): 'fold' | 'unfold' {
  const shown = (line: number) => visible.some((r) => r.start <= line && line <= r.end)
  const settingsShown = (b: { start: number; end: number }) => visible.some((r) => r.start <= b.end && r.end > b.start)
  // its first line shown, its settings not, and lines after it shown: folded
  const folded = (b: { start: number; end: number }) => shown(b.start) && !settingsShown(b) && visible.some((r) => r.start > b.end)
  if (blocks.some(settingsShown)) return 'fold'
  if (blocks.some(folded)) return 'unfold'
  return last === 'unfold' ? 'fold' : 'unfold'
}
