import { describe, expect, it } from 'vitest'
import { viewEdit } from './save-view'

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
