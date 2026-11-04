import { describe, expect, it } from 'vitest'
import { compileSlides } from '../compiler/compile-slides'
import { namedTarget, namedViewEdit, viewEdit, viewUsers } from './save-view'

const apply = (text: string, e: { start: number; end: number; text: string }) => text.slice(0, e.start) + e.text + text.slice(e.end)

const deck = (...bodies: string[]) =>
  bodies.map((b, i) => `---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n  offset: [${i}, 1, 1]\n---\n${b}\n`).join('')

describe('viewEdit', () => {
  const view = { lookAt: [0, 0.5, 0] as [number, number, number], offset: [1.234, 2, 3] as [number, number, number] }

  it('writes the view into the slide shown, found in the current text', () => {
    const shown = deck('# A', '# B')
    // unsaved typing since: a slide added before it
    const current = deck('# New', '# A', '# B')
    const e = viewEdit(shown, current, 1, view)
    expect(e && !('problem' in e)).toBe(true)
    const next = apply(current, e as { start: number; end: number; text: string })
    expect(next).toContain('# A\n---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n  offset: [1.23, 2, 3]\n---\n# B')
    expect(next.replace('[1.23, 2, 3]', '[2, 1, 1]')).toBe(current)
  })

  it('is null when the slide already has the view', () => {
    const text = deck('# A', '# B')
    expect(viewEdit(text, text, 1, { lookAt: [0, 0.5, 0], offset: [1, 1, 1] })).toBeNull()
  })

  it('refuses when the slide itself was edited since', () => {
    const e = viewEdit(deck('# A', '# B'), deck('# A', '# B, edited'), 1, view)
    expect(e && 'problem' in e && e.problem).toMatch(/edited since/)
  })
})

describe('namedTarget', () => {
  const slides =
    '---\nscene: agilus\ncamera:\n  offset: [1, 1, 1]\n---\n# A\n' +
    '---\nscene: agilus\ncamera: oversikt\n---\n# B\n' +
    '---\nscene: agilus\n---\n# C\n' +
    '---\nscene: agilus\ncamera: oversikt\n---\n# D\n' +
    '---\nscene: arm\ncamera: oversikt\n---\n# E\n'
  const files = { 'slides.md': slides, 'scenes/agilus.yaml': 'base: agilus\n' }

  it('is the named view, in the scene file, with the slides that name it', () => {
    expect(namedTarget(files, 1)).toEqual({ view: 'oversikt', path: 'scenes/agilus.yaml', users: [1, 3] })
    expect(namedTarget({ ...files, 'scenes/agilus.yaml': undefined as unknown as string, 'scenes/agilus.yml': 'base: agilus\n' }, 3)?.path).toBe(
      'scenes/agilus.yml',
    )
  })

  it('is null where V writes into the slide: its own camera, none, or a scene without a file', () => {
    expect(namedTarget(files, 0)).toBeNull()
    expect(namedTarget(files, 2)).toBeNull()
    expect(namedTarget(files, 4)).toBeNull()
    expect(namedTarget({ 'slides.md': 'not slides' }, 0)).toBeNull()
  })
})

describe('namedViewEdit', () => {
  it('changes the view in the scene file text, or says why not', () => {
    const scene = 'base: agilus\nviews:\n  oversikt:\n    lookAt: [0, 0, 0]\n    offset: [1, 1, 1]\n'
    const e = namedViewEdit(scene, 'oversikt', { lookAt: [0, 0, 0], offset: [2, 1, 1] })
    expect(e && !('problem' in e) && apply(scene, e)).toBe(scene.replace('[1, 1, 1]', '[2, 1, 1]'))
    expect(namedViewEdit(scene, 'oversikt', { lookAt: [0, 0, 0], offset: [1, 1, 1] })).toBeNull()
    const missing = namedViewEdit(scene, 'borte', { lookAt: [0, 0, 0], offset: [1, 1, 1] })
    expect(missing && 'problem' in missing && missing.problem).toMatch(/no view 'borte'/)
  })
})

describe('viewUsers', () => {
  it('lists the slides that name the view and those that carry it on', () => {
    const files = {
      'slides.md':
        '---\nscene: arm\ncamera: o\n---\n# A\n' +
        '---\nscene: arm\n---\n# B\n' +
        '---\nscene: arm\ncamera:\n  lookAt: [0, 0, 0]\n  offset: [1, 1, 1]\n---\n# C\n' +
        '---\nscene: arm\ncamera: o\n---\n# D\n',
      'scenes/arm.yaml': 'base: arm\nviews:\n  o:\n    lookAt: [0, 0, 0]\n    offset: [2, 2, 2]\n',
    }
    const cameras = compileSlides(files['slides.md'], files).map((s) => s.effective.camera)
    expect(viewUsers(files, namedTarget(files, 0)!, cameras)).toEqual([0, 1, 3])
  })

  it('lists slides that take only the lookAt from the view, or only its offset', () => {
    const files = {
      'slides.md':
        '---\nscene: arm\ncamera: o\n---\n# A\n' +
        '---\nscene: arm\ncamera:\n  offset: [1, 1, 1]\n---\n# B, the view\'s lookAt\n' +
        '---\nscene: arm\ncamera: o\n---\n# C\n' +
        '---\nscene: arm\ncamera:\n  lookAt: [0, 1, 0]\n---\n# D, the view\'s offset\n' +
        '---\nscene: arm\ncamera: o\n---\n# E\n' +
        '---\nscene: arm\ncamera:\n  distance: 3\n---\n# F, the view\'s lookAt\n' +
        '---\nscene: arm\ncamera:\n  lookAt: [1, 1, 1]\n  offset: [1, 1, 1]\n---\n# G, its own\n',
      'scenes/arm.yaml': 'base: arm\nviews:\n  o:\n    lookAt: [0, 0, 0]\n    offset: [2, 2, 2]\n',
    }
    const cameras = compileSlides(files['slides.md'], files).map((s) => s.effective.camera)
    expect(viewUsers(files, namedTarget(files, 0)!, cameras)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
