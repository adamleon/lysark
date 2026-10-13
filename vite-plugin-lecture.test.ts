import { describe, expect, it } from 'vitest'
import { lectureTitle } from './vite-plugin-lecture'

describe('lectureTitle', () => {
  it('takes the first heading in a slide body', () => {
    expect(lectureTitle('---\nid: a\n---\n# Baneplanlegging\n\n## Sub', 'fb')).toBe('Baneplanlegging')
  })

  it('skips YAML comments in frontmatter and headings in code fences', () => {
    const text = '---\n# a yaml comment\nid: a\n---\n```\n# not a title\n```\n# Real title'
    expect(lectureTitle(text, 'fb')).toBe('Real title')
  })

  it('ignores a byte-order mark', () => {
    expect(lectureTitle('﻿---\nid: a\n# comment\n---\n# Real', 'fb')).toBe('Real')
  })

  it('strips markdown emphasis and math dollars', () => {
    expect(lectureTitle('---\n---\n# PID & *tuning*: $x$', 'fb')).toBe('PID & tuning: x')
  })

  it('falls back to the folder name', () => {
    expect(lectureTitle('---\nid: a\n---\nno heading', 'fallback')).toBe('fallback')
  })
})
