import { describe, expect, it } from 'vitest'
import { setCameraView } from './camera-edit'
import { compileSlides } from '../compiler/compile-slides'

const view = { lookAt: [0.1234, 0.5, -0] as [number, number, number], offset: [1.5, 0.75, 2] as [number, number, number] }

describe('setCameraView', () => {
  it('replaces lookAt and offset in place, keeping comments and other keys byte for byte', () => {
    const src = [
      '---',
      'id: a',
      'scene: arm',
      'camera:',
      '  lookAt: [-1.75, 0.5, 0]   # look here',
      '  offset: [0.7, 1.2, 3.6]',
      '  spring: { omega: 4, zeta: 1.0 }',
      'idle:',
      '  joint1: { amp: 0.5, freq: 0.1 }',
      '---',
      '# Title',
      '',
    ].join('\n')
    const out = setCameraView(src, 0, view)
    expect(out).toBe(
      src.replace('[-1.75, 0.5, 0]', '[0.12, 0.5, 0]').replace('[0.7, 1.2, 3.6]', '[1.5, 0.75, 2]'),
    )
  })

  it('adds a camera block to a slide that has none', () => {
    const src = '---\nid: a\nscene: arm\n---\nbody\n'
    expect(setCameraView(src, 0, view)).toBe(
      '---\nid: a\nscene: arm\ncamera:\n  lookAt: [0.12, 0.5, 0]\n  offset: [1.5, 0.75, 2]\n---\nbody\n',
    )
  })

  it('adds a missing offset with the block indentation, and drops distance', () => {
    const src = '---\nscene: arm\ncamera:\n    lookAt: end_effector\n    distance: 0.6\n---\nx'
    const out = setCameraView(src, 0, { lookAt: 'end_effector', offset: [0.4, 0.2, 0.5] })
    expect(out).toBe('---\nscene: arm\ncamera:\n    lookAt: end_effector\n    offset: [0.4, 0.2, 0.5]\n---\nx')
  })

  it('keeps an anchor lookAt when the view looks at that anchor', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt: end_effector\n  offset: [1, 1, 1]\n---\nx'
    const out = setCameraView(src, 0, { lookAt: 'end_effector', offset: [0.4, 0.2, 0.5] })
    expect(out).toBe('---\nscene: arm\ncamera:\n  lookAt: end_effector\n  offset: [0.4, 0.2, 0.5]\n---\nx')
  })

  it('rewrites a flow-style camera, keeping its other entries', () => {
    const src = '---\nscene: arm\ncamera: { lookAt: [0, 0.45, 0], distance: 2, spring: { omega: 5 } }\n---\nx'
    expect(setCameraView(src, 0, view)).toBe(
      '---\nscene: arm\ncamera: { lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2], spring: { omega: 5 } }\n---\nx',
    )
  })

  it('fills empty values, keeping a comment after them', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt:\n  offset:   # set with V\n  spring: { omega: 5 }\n---\nx'
    const out = setCameraView(src, 0, view)
    expect(out).toBe(
      '---\nscene: arm\ncamera:\n  lookAt: [0.12, 0.5, 0]\n  offset: [1.5, 0.75, 2]   # set with V\n  spring: { omega: 5 }\n---\nx',
    )
    expect(compileSlides(out)[0].effective.camera).toMatchObject({ lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
  })

  it('replaces a value written as a block list, keeping the next key on its own line', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt:\n    - 1\n    - 2\n    - 3\n  offset: [0.7, 1.2, 3.6]\n---\nx'
    const out = setCameraView(src, 0, view)
    expect(out).toBe('---\nscene: arm\ncamera:\n  lookAt: [0.12, 0.5, 0]\n  offset: [1.5, 0.75, 2]\n---\nx')
    expect(compileSlides(out)[0].effective.camera).toEqual({ lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
  })

  it('replaces explicit nulls', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt: ~\n  offset: null\n---\nx'
    expect(setCameraView(src, 0, view)).toBe('---\nscene: arm\ncamera:\n  lookAt: [0.12, 0.5, 0]\n  offset: [1.5, 0.75, 2]\n---\nx')
  })

  it('splices values in a multi-line flow camera, keeping its comments', () => {
    const src = '---\nscene: arm\ncamera: {\n  lookAt: [0, 0.45, 0], # the arm\n  offset: [1, 1, 1]\n}\n---\nx'
    const out = setCameraView(src, 0, view)
    expect(out).toBe('---\nscene: arm\ncamera: {\n  lookAt: [0.12, 0.5, 0], # the arm\n  offset: [1.5, 0.75, 2]\n}\n---\nx')
    expect(compileSlides(out)[0].effective.camera).toEqual({ lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
  })

  it('writes into the right slide, skipping --- inside code fences', () => {
    const src = '---\nid: a\nscene: arm\n---\n```yaml\n---\nnot: frontmatter\n---\n```\n---\nid: b\nscene: arm\n---\ntwo\n'
    const out = setCameraView(src, 1, view)
    expect(out).toContain('id: b\nscene: arm\ncamera:\n  lookAt: [0.12, 0.5, 0]')
    expect(out.split('camera:').length - 1).toBe(1)
    expect(compileSlides(out)[1].effective.camera).toEqual({ lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
  })

  it('keeps Windows line endings and a byte-order mark', () => {
    const src = '﻿---\r\nid: a\r\nscene: arm\r\n---\r\nbody\r\n'
    const out = setCameraView(src, 0, view)
    expect(out.startsWith('﻿---\r\nid: a\r\nscene: arm\r\ncamera:\r\n')).toBe(true)
    expect(out).not.toMatch(/[^\r]\n/)
  })

  it('refuses frontmatter it cannot edit safely', () => {
    expect(() => setCameraView('---\ncamera: [1, 2]\n---\nx', 0, view)).toThrow(/not a mapping/)
    expect(() => setCameraView('---\ncamera: {\n---\nx', 0, view)).toThrow(/YAML error/)
    expect(() => setCameraView('---\nid: a\n---\nx', 3, view)).toThrow(/no slide 4/)
  })
})
