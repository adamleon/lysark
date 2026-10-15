/**
 * Where each slide sits in a slides.md, by line. The compiler splits slides
 * with this, and the editor uses it to find the slide under the cursor and the
 * frontmatter to write a saved camera view into, so both agree on the rules:
 * a slide starts with a `---` fence (trailing whitespace allowed), its YAML
 * frontmatter runs to the next `---`, and its body runs to the next fence that
 * is not inside a fenced code block.
 *
 * Line numbers are 0-based and count lines the same way with \n or \r\n.
 */

const FENCE = /^(?:`{3,}|~{3,})/

export interface SlideRange {
  /** the opening `---` line */
  fenceLine: number
  /** first YAML line; equals yamlEnd when the frontmatter is empty */
  yamlStart: number
  /** the closing `---` line (exclusive end of the YAML) */
  yamlEnd: number
  /** first body line */
  bodyStart: number
  /** exclusive end of the body: the next slide's fence line, or the line count */
  bodyEnd: number
}

export function splitLines(source: string): string[] {
  return source.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')
}

export function slideRanges(source: string): SlideRange[] {
  const lines = splitLines(source)
  const isSep = (line: string) => line.trimEnd() === '---'
  const ranges: SlideRange[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    if (!isSep(lines[i])) {
      throw new Error(`slides: expected '---' frontmatter fence at line ${i + 1}, got: ${lines[i]}`)
    }
    const fenceLine = i
    const yamlStart = ++i
    while (i < lines.length && !isSep(lines[i])) i++
    if (i >= lines.length) throw new Error('slides: unterminated frontmatter block')
    const yamlEnd = i
    i++ // skip closing fence
    const bodyStart = i
    let inFence = false
    while (i < lines.length && !(isSep(lines[i]) && !inFence)) {
      if (FENCE.test(lines[i].trimStart())) inFence = !inFence
      i++
    }
    ranges.push({ fenceLine, yamlStart, yamlEnd, bodyStart, bodyEnd: i })
  }
  return ranges
}

/** index of the slide that contains a line, or -1 before the first slide */
export function slideAtLine(ranges: SlideRange[], line: number): number {
  let found = -1
  for (let k = 0; k < ranges.length; k++) {
    if (ranges[k].fenceLine <= line) found = k
    else break
  }
  return found
}
