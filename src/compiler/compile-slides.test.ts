import { describe, expect, it } from 'vitest'
import { compileSlides } from './compile-slides'

const deck = `---
id: one
scene: arm
layout: center
joints:
  joint1: 0.5
  joint2: 1.0
camera:
  lookAt: [0, 0.45, 0]
  offset: [1.9, 0.75, 1.9]
---
# Title

Intro line with $\\omega_n$ inline math.
<!-- pause -->
- revealed later

---
id: two
scene: arm
joints:
  joint2: -0.4
camera:
  distance: 0.6
widgets:
  - type: slider
    bind: joint3
    pid: { kd: 0.6 }
---
Body two

$$\\tau = K_p e$$
`

describe('compileSlides', () => {
  it('resolves cumulative effective targets per slide (spec §4.3)', () => {
    const [one, two] = compileSlides(deck)
    expect(one.effective.joints).toEqual({ joint1: 0.5, joint2: 1.0 })
    // slide two inherits joint1, overrides joint2
    expect(two.effective.joints).toEqual({ joint1: 0.5, joint2: -0.4 })
  })

  it('camera merges per key; a declared distance replaces an inherited offset', () => {
    const [one, two] = compileSlides(deck)
    expect(one.effective.camera?.offset).toEqual([1.9, 0.75, 1.9])
    expect(two.effective.camera?.lookAt).toEqual([0, 0.45, 0]) // inherited
    expect(two.effective.camera?.distance).toBe(0.6)
    expect(two.effective.camera?.offset).toBeUndefined()
  })

  it('splits fragments on <!-- pause --> and renders markdown + KaTeX', () => {
    const [one, two] = compileSlides(deck)
    expect(one.fragments).toHaveLength(2)
    expect(one.fragments[0]).toContain('<h1>')
    expect(one.fragments[0]).toContain('katex') // inline math pre-rendered
    expect(one.fragments[1]).toContain('<li>revealed later</li>')
    expect(two.fragments[0]).toContain('katex-display') // $$…$$ display mode
  })

  it('carries widgets and layout through', () => {
    const [one, two] = compileSlides(deck)
    expect(one.layout).toBe('center')
    expect(two.layout).toBe('panel')
    expect(two.widgets).toEqual([{ type: 'slider', bind: 'joint3', pid: { kd: 0.6 } }])
  })

  it('rejects duplicate ids and unknown widget types', () => {
    expect(() => compileSlides('---\nid: a\n---\nx\n---\nid: a\n---\ny')).toThrow(/duplicate/)
    expect(() =>
      compileSlides('---\nwidgets:\n  - type: dial\n    bind: j1\n---\nx'),
    ).toThrow(/unknown widget type/)
  })
})
