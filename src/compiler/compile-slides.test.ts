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
      compileSlides('---\nscene: arm\nwidgets:\n  - type: dial\n    bind: j1\n---\nx'),
    ).toThrow(/unknown widget type/)
  })
})

describe('compileSlides — code fences (review findings)', () => {
  it("'---' inside a fenced code block does not fabricate slides", () => {
    const src = '---\nid: a\nscene: arm\n---\nA launch file:\n\n```yaml\n---\nkey: value\n---\n```\ndone'
    const slides = compileSlides(src)
    expect(slides).toHaveLength(1)
    expect(slides[0].fragments[0]).toContain('key: value')
  })

  it('<!-- pause --> inside a fence does not split the fragment', () => {
    const src = '---\nscene: arm\n---\n```\nline\n<!-- pause -->\nmore\n```'
    const slides = compileSlides(src)
    expect(slides[0].fragments).toHaveLength(1)
    expect(slides[0].fragments[0]).toContain('pause')
  })

  it('$ inside code spans and fences is never treated as math', () => {
    const src = '---\nscene: arm\n---\nRun `export A=$FOO B=$BAR` then:\n\n```bash\necho $ROS_DOMAIN_ID $ROS_MASTER_URI\n```'
    const [slide] = compileSlides(src)
    expect(slide.fragments[0]).toContain('$FOO B=$BAR')
    expect(slide.fragments[0]).toContain('$ROS_DOMAIN_ID $ROS_MASTER_URI')
    expect(slide.fragments[0]).not.toContain('katex')
  })

  it('tolerates trailing whitespace on frontmatter fences', () => {
    const src = '--- \nid: a\nscene: arm\n---  \nbody'
    expect(compileSlides(src)).toHaveLength(1)
  })
})

describe('compileSlides — scene runs (spec §3/§4.3)', () => {
  it('resets effective targets at scene boundaries — no leak across scenes', () => {
    const src = [
      '---\nscene: arm\njoints: { joint1: 0.9 }\ncamera: { lookAt: [0, 0.4, 0], offset: [1, 1, 1] }\n---\na',
      '---\nscene: gripper\n---\nb',
    ].join('\n')
    const [, gripper] = compileSlides(src)
    expect(gripper.effective.joints).toEqual({})
    expect(gripper.effective.camera).toBeUndefined()
  })

  it('errors on non-contiguous reuse of a scene id', () => {
    const src = '---\nscene: arm\n---\na\n---\nscene: gripper\n---\nb\n---\nscene: arm\n---\nc'
    expect(() => compileSlides(src)).toThrow(/non-contiguously/)
  })

  it('scene-less slides may not declare joints, camera, or widgets', () => {
    expect(() => compileSlides('---\njoints: { j1: 0.5 }\n---\nx')).toThrow(/scene-less/)
    const ok = compileSlides('---\nlayout: center\n---\nJust text')
    expect(ok[0].effective).toEqual({})
  })
})

describe('compileSlides — schema validation (review findings)', () => {
  it('deep-merges spring so a partial override keeps the inherited sibling', () => {
    const src = [
      '---\nscene: arm\ncamera: { lookAt: [0, 0, 0], offset: [1, 1, 1], spring: { omega: 5, zeta: 1 } }\n---\na',
      '---\nscene: arm\ncamera: { spring: { zeta: 0.5 } }\n---\nb',
    ].join('\n')
    const [, b] = compileSlides(src)
    expect(b.effective.camera?.spring).toEqual({ omega: 5, zeta: 0.5 })
  })

  it('rejects offset+distance on one slide, non-finite joints, malformed vectors', () => {
    expect(() =>
      compileSlides('---\nscene: arm\ncamera: { offset: [1, 1, 1], distance: 0.5 }\n---\nx'),
    ).toThrow(/alternative framings/)
    expect(() => compileSlides('---\nscene: arm\njoints: { j1: .nan }\n---\nx')).toThrow(/finite/)
    expect(() => compileSlides('---\nscene: arm\njoints: 3\n---\nx')).toThrow(/mapping/)
    expect(() =>
      compileSlides('---\nscene: arm\ncamera: { offset: [1, 1] }\n---\nx'),
    ).toThrow(/\[x, y, z\]/)
    expect(() => compileSlides('---\nid: 3\n---\nx')).toThrow(/'id' must be a string/)
  })
})
