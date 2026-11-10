import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deckModuleCode, lectureTitle } from './vite-plugin-lecture'

describe('deckModuleCode', () => {
  let lecture: string
  const ENGINE = '/engine'
  /** the deck module of a lecture whose scene file has these objects, and whose slides run `scene` */
  const deck = (scene: string | null, objects: string) => {
    writeFileSync(join(lecture, 'slides.md'), scene ? `---\nscene: ${scene}\n---\n# x\n` : '---\nid: a\n---\n# x\n')
    writeFileSync(join(lecture, 'scenes', 'arm.yaml'), `base: arm\nobjects:\n${objects}`)
    return deckModuleCode(ENGINE, lecture)
  }

  beforeAll(() => {
    lecture = mkdtempSync(join(tmpdir(), 'lysark-deck-'))
    mkdirSync(join(lecture, 'scenes'))
  })
  afterAll(() => rmSync(lecture, { recursive: true, force: true }))

  it('imports the model loader, with the models, when a scene the slides run has a model', () => {
    const code = deck('arm', '  table:\n    box: [0.4, 0.3, 0.4]\n  part:\n    model: models/part.stl\n    parent: table\n')
    expect(code).toContain(`import slides, { models } from ${JSON.stringify(join(lecture, 'slides.md').replace(/\\/g, '/'))}`)
    expect(code).toContain('import { modelLoader } from "/engine/src/scene/models.ts"')
    expect(code).toMatch(/defineDeck\(\{ scenes: \{ "arm": scene0 \}, slides, objects: .*"model":\{"src":"models\/part\.stl".*, models: modelLoader\(models\) \}\)$/)
  })

  it('carries no model loader for a lecture without models, or with them only in a scene no slide runs', () => {
    for (const code of [deck('arm', '  table:\n    box: [0.4, 0.3, 0.4]\n'), deck(null, '  part:\n    model: models/part.stl\n')]) {
      expect(code).not.toContain('modelLoader')
      expect(code).not.toContain('{ models }')
      expect(code).toMatch(/^import slides from /m)
    }
  })
})

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
