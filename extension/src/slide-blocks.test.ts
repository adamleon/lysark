import { readFileSync } from 'node:fs'
import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { slideRanges } from '../../src/compiler/slide-ranges'
import {
  blankSettings,
  carriedBlocks,
  foldingBlocks,
  halfTyped,
  isLecturePath,
  separators,
  slideBlocks,
  slideLabel,
  SlideTracker,
  splitBlocks,
  strayFences,
  toggleAction,
} from './slide-blocks'

const lf = (...lines: string[]) => lines.join('\n')
const crlf = (...lines: string[]) => lines.join('\r\n')
const demo = () => readFileSync(new URL('../../lectures/demo/slides.md', import.meta.url), 'utf8')

const DECK = [
  '---', //                      0
  'id: title', //                1
  'scene: arm', //               2
  '# a comment in the settings', // 3
  '---', //                      4
  '# Lysark', //                 5
  '', //                         6
  '---', //                      7
  'id: second', //               8
  'camera: overview', //         9
  '---', //                     10
  '## Second', //               11
  '', //                        12
]
const THIRD = ['---', 'id: third', '---', '## Third', '']

/** the headings markdown-it finds (ATX or setext), as `## text` */
function headings(text: string): string[] {
  const tokens = new MarkdownIt({ html: true }).parse(text, {})
  return tokens.flatMap((t, k) => (t.type === 'heading_open' ? [`${'#'.repeat(Number(t.tag.slice(1)))} ${tokens[k + 1].content}`] : []))
}

/** the text as VS Code's Markdown parse gets it from the plugin, for a document first seen with this text */
const blanked = (text: string) => {
  const { blocks, strays } = new SlideTracker().settings(text)
  return blankSettings(text, blocks, strays)
}

/** a tracker that has seen `first`, then `then`: what it gives for `then` */
function after(first: string, then: string) {
  const tracker = new SlideTracker()
  tracker.settings(first)
  return tracker.settings(then)
}

/** the text as the plugin hands it to markdown-it, for a tracker that has seen `first` */
function blankedAfter(first: string, then: string): string {
  const { blocks, strays } = after(first, then)
  return blankSettings(then, blocks, strays)
}

describe('isLecturePath', () => {
  it('is a slides.md in a lecture folder under lectures/', () => {
    expect(isLecturePath('/c:/course/lectures/baneplanlegging/slides.md')).toBe(true)
    expect(isLecturePath('/adamleon/ais2105-lectures/lectures/pid/slides.md')).toBe(true)
    // Slidev's default entry file, a deck elsewhere, and a slides.md at the top of lectures/
    expect(isLecturePath('/talk/slides.md')).toBe(false)
    expect(isLecturePath('/course/decks/pid/slides.md')).toBe(false)
    expect(isLecturePath('/course/lectures/slides.md')).toBe(false)
    expect(isLecturePath('/course/lectures/pid/old/slides.md')).toBe(false)
    expect(isLecturePath('/course/lectures/pid/README.md')).toBe(false)
  })
})

describe('slideBlocks', () => {
  it('finds each settings block and its id, with \\n or \\r\\n', () => {
    const want = [
      { open: 0, close: 4, id: 'title' },
      { open: 7, close: 10, id: 'second' },
    ]
    expect(slideBlocks(lf(...DECK))).toEqual(want)
    expect(slideBlocks(crlf(...DECK))).toEqual(want)
  })

  it('counts lines after a BOM as VS Code does', () => {
    expect(slideBlocks(`\uFEFF${lf(...DECK)}`)).toEqual(slideBlocks(lf(...DECK)))
  })

  it('a slide without an id has none', () => {
    expect(slideBlocks(lf('---', 'scene: arm', '---', '# A'))).toEqual([{ open: 0, close: 2, id: null }])
  })

  it('reads a quoted id and one with a comment, and only a top-level one', () => {
    const id = (line: string) => slideBlocks(lf('---', 'scene: arm', line, '---', 'body'))[0].id
    expect(id('id: "quoted one"')).toBe('quoted one')
    expect(id("id: 'single'  # why")).toBe('single')
    expect(id('id: plain # a comment')).toBe('plain')
    expect(id('id:')).toBeNull()
    expect(id('  id: nested')).toBeNull()
    expect(id('idle: x')).toBeNull()
  })

  it('finds none in text that doesn’t split into slides', () => {
    const before = lf('stray text', '', ...DECK)
    expect(() => slideRanges(before)).toThrow(/expected '---'/)
    expect(slideBlocks(before)).toEqual([])
    const unterminated = lf(...DECK, '---', 'id: new')
    expect(() => slideRanges(unterminated)).toThrow(/unterminated/)
    expect(slideBlocks(unterminated)).toEqual([])
  })

  it('a --- inside a fenced code block in a body is body text', () => {
    const text = lf('---', 'id: a', '---', '```yaml', '---', 'not: settings', '---', '```', '---', 'id: b', '---', 'text')
    expect(slideBlocks(text)).toEqual([
      { open: 0, close: 2, id: 'a' },
      { open: 8, close: 10, id: 'b' },
    ])
  })

  it('agrees with the compiler on the demo lecture', () => {
    const text = demo()
    expect(slideBlocks(text).map(({ open, close }) => ({ open, close }))).toEqual(slideRanges(text).map((r) => ({ open: r.fenceLine, close: r.yamlEnd })))
  })
})

describe('SlideTracker, while a new slide is half typed', () => {
  const deck = [...DECK, ...THIRD]
  // a new slide typed into slide 1's body, up to its opening --- so far
  const midway = lf(...deck.slice(0, 7), '---', ...deck.slice(7))

  it('the compiler’s rules would pair the new --- with the next slide’s', () => {
    expect(splitBlocks(midway)).toBeNull()
  })

  it('keeps the blocks of the last text that split, where they still stand, and its new --- is a stray', () => {
    expect(after(lf(...deck), midway)).toEqual({
      blocks: [
        { open: 0, close: 4, id: 'title' },
        { open: 8, close: 11, id: 'second' },
        { open: 14, close: 16, id: 'third' },
      ],
      strays: [7],
    })
  })

  it('then the compiler’s blocks again once the new slide’s closing --- is typed', () => {
    const tracker = new SlideTracker()
    tracker.settings(lf(...deck))
    tracker.settings(midway)
    tracker.settings(lf(...deck.slice(0, 7), '---', 'id: new', ...deck.slice(7)))
    expect(tracker.settings(lf(...deck.slice(0, 7), '---', 'id: new', '---', '## New', ...deck.slice(7))).blocks).toEqual([
      { open: 0, close: 4, id: 'title' },
      { open: 7, close: 9, id: 'new' },
      { open: 11, close: 14, id: 'second' },
      { open: 17, close: 19, id: 'third' },
    ])
  })

  it('so the outline keeps every slide’s heading, and no body line is blanked', () => {
    const out = blankedAfter(lf(...deck), midway)
    expect(headings(out)).toEqual(['# Lysark', '## Second', '## Third'])
    expect(out.split('\n').slice(5, 8)).toEqual(['# Lysark', '', ''])
  })

  it('a --- typed right under a line of text doesn’t make it a heading', () => {
    // in Markdown a line of text with --- under it is a heading
    const under = lf(...deck.slice(0, 5), 'A paragraph.', '---', ...deck.slice(7))
    const before = lf(...deck.slice(0, 5), 'A paragraph.', ...deck.slice(7))
    expect(headings(under)).toContain('## A paragraph.')
    expect(headings(blankedAfter(before, under))).toEqual(['## Second', '## Third'])
  })

  it('a new slide typed at the end gets no block until its closing ---', () => {
    expect(after(lf(...DECK), lf(...DECK, '---', 'id: new'))).toEqual({ blocks: slideBlocks(lf(...DECK)), strays: [13] })
  })

  it('leaves out a block the typing changed, until the text splits again', () => {
    const edited = [...deck]
    edited[9] = 'camera: tool'
    expect(after(lf(...deck), lf(...edited.slice(0, 7), '---', ...edited.slice(7))).blocks).toEqual([
      { open: 0, close: 4, id: 'title' },
      { open: 14, close: 16, id: 'third' },
    ])
  })

  it('keeps the blocks when a --- typed mid-file splits wrongly, past a code fence holding ---', () => {
    const fenced = ['---', 'id: a', '---', '# A', '', '---', 'id: b', '---', '# B', '```yaml', '---', 'x: 1', '```', '', '---', 'id: c', '---', '# C', '']
    const typing = lf(...fenced.slice(0, 5), '---', ...fenced.slice(5))
    // by the compiler's rules: the new --- and B's are an empty block, B's settings its body,
    // and B's closing --- opens a block that holds B's heading and code fence
    expect(splitBlocks(typing)).toEqual([
      { open: 0, close: 2 },
      { open: 5, close: 6 },
      { open: 8, close: 11 },
    ])
    expect(after(lf(...fenced), typing)).toEqual({
      blocks: [
        { open: 0, close: 2, id: 'a' },
        { open: 6, close: 8, id: 'b' },
        { open: 15, close: 17, id: 'c' },
      ],
      strays: [5],
    })
    expect(headings(blankedAfter(lf(...fenced), typing))).toEqual(['# A', '# B', '# C'])
  })

  it('keeps the blocks while a code fence typed into a body is open', () => {
    const typing = lf(...deck.slice(0, 6), '```', ...deck.slice(6))
    // the open fence swallows the slides after it
    expect(splitBlocks(typing)).toEqual([{ open: 0, close: 4 }])
    expect(after(lf(...deck), typing).blocks.map((b) => b.id)).toEqual(['title', 'second', 'third'])
    expect(after(lf(...deck), lf(...deck.slice(0, 6), '```', 'code', '```', ...deck.slice(6))).blocks.map((b) => b.open)).toEqual([0, 10, 16])
  })

  it('takes the compiler’s blocks once a finished edit makes a slide body text: a slide put inside a code fence', () => {
    const tracker = new SlideTracker()
    tracker.settings(lf(...deck))
    // the empty line above the second slide becomes an opening fence, which swallows the slides after it
    const opened = [...deck]
    opened[6] = '```md'
    expect(tracker.settings(lf(...opened)).blocks.map((b) => b.id)).toEqual(['title', 'second', 'third'])
    // closed after the second slide's body: that slide is now an example in the first one's body,
    // though its lines stand unchanged where they were
    const closed = [...opened.slice(0, 13), '```', ...opened.slice(13)]
    expect(tracker.settings(lf(...closed)).blocks.map((b) => b.id)).toEqual(['title', 'third'])
    // and a slide added after that gets its block
    expect(tracker.settings(lf(...closed, '---', 'id: fourth', '---')).blocks.map((b) => b.id)).toEqual(['title', 'third', 'fourth'])
  })

  it('halfTyped: an earlier block’s --- line that changed sides, or a last body inside an open code fence', () => {
    const halfTypedIn = (text: string, carried: Array<{ open: number; close: number }>) => halfTyped(text.split('\n'), slideRanges(text), carried)
    // blocks 0-2 and 4-5, then the body
    const text = lf('---', 'a: 1', '---', 'Text', '---', '---', 'Body', 'More')
    expect(halfTypedIn(text, [{ open: 5, close: 7 }])).toBe(true) // an opening line that now closes a block
    expect(halfTypedIn(text, [{ open: 3, close: 4 }])).toBe(true) // a closing line that now opens one
    expect(halfTypedIn(text, [{ open: 6, close: 7 }])).toBe(false) // lines that are body text now
    expect(halfTypedIn(lf('---', 'a: 1', '---', '```', 'Body'), [])).toBe(true)
    expect(halfTypedIn(lf('---', 'a: 1', '---', '```', 'code', '```'), [])).toBe(false)
  })

  it('carriedBlocks keeps blocks in order and inside the text', () => {
    const before = { lines: lf(...DECK).split('\n'), blocks: splitBlocks(lf(...DECK))! }
    expect(carriedBlocks(before, ['---'])).toEqual([])
    // the first slide deleted: the second is found where the shorter text moved it
    expect(carriedBlocks(before, lf(...DECK.slice(5)).split('\n'))).toEqual([{ open: 2, close: 5 }])
  })

  it('strayFences skips the blocks and code fences', () => {
    const lines = ['---', 'a: 1', '---', '```', '---', '```', '---', 'text', '~~~', '---']
    expect(strayFences(lines, [{ open: 0, close: 2 }])).toEqual([6])
    // a fence left open in one body ends at the next block
    expect(strayFences(['---', 'a: 1', '---', '```', '---', 'b: 2', '---', '---'], [{ open: 0, close: 2 }, { open: 4, close: 6 }])).toEqual([7])
  })
})

describe('SlideTracker, a document first seen unfinished', () => {
  it('is left as it is until it splits: a settings block left open mid-file', () => {
    // its bodies after the open block would pair as settings by the compiler's rules
    const text = lf(...DECK.slice(0, 7), '---', 'id: broken', '', ...DECK.slice(7), ...THIRD)
    const tracker = new SlideTracker()
    expect(tracker.settings(text)).toEqual({ blocks: [], strays: [] })
    expect(blanked(text)).toBe(text)
    expect(tracker.foldsOnOpen).toBe(false)
    // finished: the compiler's blocks
    const done = lf(...DECK.slice(0, 7), '---', 'id: fixed', '---', '## Fixed', ...DECK.slice(7), ...THIRD)
    expect(tracker.settings(done).blocks.map((b) => b.id)).toEqual(['title', 'fixed', 'second', 'third'])
  })

  it('is left as it is with text before the first ---, which the compiler refuses', () => {
    const text = lf('id: title', 'scene: arm', '---', '# Lysark', '', ...DECK.slice(7))
    expect(new SlideTracker().settings(text)).toEqual({ blocks: [], strays: [] })
  })
})

describe('SlideTracker.foldsOnOpen', () => {
  it('is whether the first text had a block to fold, and stays so', () => {
    const lecture = new SlideTracker()
    lecture.settings(lf(...DECK))
    expect(lecture.foldsOnOpen).toBe(true)
    lecture.settings('')
    expect(lecture.foldsOnOpen).toBe(true)

    const empty = new SlideTracker()
    empty.settings('')
    expect(empty.foldsOnOpen).toBe(false)
    // the first slide typed into a new lecture is folded only once it is opened again
    expect(foldingBlocks(empty.settings(lf('---', 'id: first', '---')).blocks)).toEqual([{ start: 0, end: 2 }])
    expect(empty.foldsOnOpen).toBe(false)

    const onlyEmptyBlocks = new SlideTracker()
    onlyEmptyBlocks.settings(lf('---', '---', '# A'))
    expect(onlyEmptyBlocks.foldsOnOpen).toBe(false)
  })
})

describe('blankSettings', () => {
  it('empties every line of each block, keeping the line count and each line ending', () => {
    for (const join of [lf, crlf]) {
      const out = blanked(join(...DECK))
      const eol = join === lf ? '\n' : '\r\n'
      expect(out.split(eol)).toEqual(['', '', '', '', '', '# Lysark', '', '', '', '', '', '## Second', ''])
    }
  })

  it('keeps mixed line endings line by line', () => {
    expect(blanked('---\r\nid: a\n---\r\n# A\n')).toBe('\r\n\n\r\n# A\n')
  })

  it('blanks the stray --- lines too', () => {
    expect(blankSettings(lf('---', 'a: 1', '---', 'Text', '---', 'b'), [{ open: 0, close: 2 }], [4])).toBe(lf('', '', '', 'Text', '', 'b'))
  })

  it('leaves the outline only the headings of the bodies', () => {
    const text = lf(...DECK)
    // without: the comment line and the settings above each closing --- are headings
    expect(headings(text)).toEqual(['# a comment in the settings', '# Lysark', '## id: second\ncamera: overview', '## Second'])
    expect(headings(blanked(text))).toEqual(['# Lysark', '## Second'])
  })

  it('leaves the demo lecture only its slides’ headings', () => {
    const text = demo()
    const bodies = slideRanges(text).flatMap((r) => headings(text.replace(/\r\n/g, '\n').split('\n').slice(r.bodyStart, r.bodyEnd).join('\n')))
    expect(headings(blanked(text))).toEqual(bodies)
    expect(bodies.length).toBeGreaterThan(5)
  })

  it('drops a BOM with the first line, and keeps the line count', () => {
    expect(blanked(`\uFEFF${lf(...DECK)}`)).toBe(blanked(lf(...DECK)))
  })

  it('blanks an empty block’s two --- lines', () => {
    expect(blanked(lf('---', '---', 'Text', '---', '---', '# A'))).toBe(lf('', '', 'Text', '', '', '# A'))
  })

  it('leaves a --- inside a fenced code block alone', () => {
    expect(blanked(lf('---', 'id: a', '---', '```', '---', '```'))).toBe(lf('', '', '', '```', '---', '```'))
  })

  it('leaves text with no slide as it is', () => {
    const readme = lf('# Course', '', 'Text', '', '---', '## Between rules', '---', '', '## Lectures')
    expect(splitBlocks(readme)).toBeNull()
    expect(blanked(readme)).toBe(readme)
  })
})

describe('separators and folding', () => {
  it('labels each slide with its number and id', () => {
    expect(slideLabel(0, 'title')).toBe('slide 1 · title')
    expect(slideLabel(11, null)).toBe('slide 12')
    expect(separators(slideBlocks(lf(...DECK)))).toEqual([
      { line: 0, label: 'slide 1 · title' },
      { line: 7, label: 'slide 2 · second' },
    ])
  })

  it('numbers the slides from the blocks it has while a new one is half typed', () => {
    expect(separators(after(lf(...DECK, ...THIRD), lf(...DECK.slice(0, 7), '---', 'scene: arm', ...DECK.slice(7), ...THIRD)).blocks)).toEqual([
      { line: 0, label: 'slide 1 · title' },
      { line: 9, label: 'slide 2 · second' },
      { line: 15, label: 'slide 3 · third' },
    ])
  })

  it('folds blocks from opening to closing ---, but not an empty one', () => {
    expect(foldingBlocks(slideBlocks(lf(...DECK, '---', '---', 'empty')))).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 10 },
    ])
    expect(foldingBlocks(slideBlocks(crlf(...DECK)))).toEqual(foldingBlocks(slideBlocks(lf(...DECK))))
  })
})

describe('toggleAction', () => {
  const blocks = [
    { start: 0, end: 4 },
    { start: 7, end: 10 },
    { start: 30, end: 33 },
  ]

  it('folds all if a block in sight has its settings open', () => {
    // the second open
    expect(toggleAction(blocks, [{ start: 0, end: 0 }, { start: 5, end: 20 }], null)).toBe('fold')
    // only the end of an open block, at the top
    expect(toggleAction(blocks, [{ start: 9, end: 20 }], 'fold')).toBe('fold')
  })

  it('opens all if the blocks in sight are folded', () => {
    // VS Code's visible ranges skip a folded block's lines after its first
    expect(toggleAction(blocks, [{ start: 0, end: 0 }, { start: 5, end: 7 }, { start: 11, end: 25 }], 'unfold')).toBe('unfold')
  })

  it('with no block in sight, does the opposite of what it did last, and opens the first time', () => {
    const body = [{ start: 12, end: 28 }]
    expect(toggleAction(blocks, body, null)).toBe('unfold')
    expect(toggleAction(blocks, body, 'unfold')).toBe('fold')
    expect(toggleAction(blocks, body, 'fold')).toBe('unfold')
  })

  it('can’t tell from an opening line at the bottom alone', () => {
    expect(toggleAction(blocks, [{ start: 12, end: 30 }], 'unfold')).toBe('fold')
    expect(toggleAction(blocks, [{ start: 12, end: 30 }], 'fold')).toBe('unfold')
  })
})
