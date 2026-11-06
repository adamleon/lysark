import { describe, expect, it } from 'vitest'
import { addNamedView, newSceneFile, setCameraName, setCameraView, setNamedView, viewNameProblem } from './camera-edit'
import { readSceneFiles } from '../compiler/scene-files'
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

  it('keeps a blank line before the closing fence when it adds a key', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n\n---\n# A\n'
    expect(setCameraView(src, 0, { lookAt: [0, 0.5, 0], offset: [1, 2, 3] })).toBe(
      '---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n  offset: [1, 2, 3]\n\n---\n# A\n',
    )
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

  it('keeps a value written as a block list one item per line, comments included', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt:   # where it looks\n    - 1     # sideways\n    - 2\n    - 3\n  offset: [0.7, 1.2, 3.6]\n---\nx'
    const out = setCameraView(src, 0, view)
    expect(out).toBe('---\nscene: arm\ncamera:\n  lookAt:   # where it looks\n    - 0.12     # sideways\n    - 0.5\n    - 0\n  offset: [1.5, 0.75, 2]\n---\nx')
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

describe('setNamedView', () => {
  const scene = [
    '# the cell',
    'base: agilus',
    '',
    'views:',
    '  oversikt:                  # the whole cell',
    '    lookAt: [-1.1, 0.55, 0]',
    '    offset: [0.6, 1.5, 3.2]',
    '  nært: { lookAt: tool0, offset: [1, 1, 1], spring: { omega: 5 } }   # close',
    '',
  ].join('\n')

  it('changes only the values of that view, comments and other views kept', () => {
    const out = setNamedView(scene, 'oversikt', { lookAt: [-1, 0.5, 0], offset: [0.7, 1.4, 3] })
    expect(out).toBe(scene.replace('[-1.1, 0.55, 0]', '[-1, 0.5, 0]').replace('[0.6, 1.5, 3.2]', '[0.7, 1.4, 3]'))
  })

  it('keeps an anchor and a spring in a flow-style view', () => {
    const out = setNamedView(scene, 'nært', { lookAt: 'tool0', offset: [0.4, 0.2, 0.55] })
    expect(out).toBe(scene.replace('offset: [1, 1, 1]', 'offset: [0.4, 0.2, 0.55]'))
  })

  it('keeps Windows line endings and a byte-order mark', () => {
    const windows = '﻿' + scene.replace(/\n/g, '\r\n')
    const out = setNamedView(windows, 'oversikt', { lookAt: [-1.1, 0.55, 0], offset: [1, 2, 3] })
    expect(out).toBe(windows.replace('[0.6, 1.5, 3.2]', '[1, 2, 3]'))
  })

  it('refuses a view the file does not have', () => {
    expect(() => setNamedView(scene, 'borte', { lookAt: [0, 0, 0], offset: [1, 1, 1] })).toThrow(/no view 'borte'/)
  })
})

describe('lists with tags', () => {
  it('rewrites a list whose items carry a tag, so the new numbers stay numbers', () => {
    const src = '---\nscene: arm\ncamera:\n  lookAt:\n    - !!int 1\n    - 2\n    - 3\n  offset: [0.7, 1.2, 3.6]\n---\nx'
    const out = setCameraView(src, 0, { lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
    expect(compileSlides(out)[0].effective.camera).toEqual({ lookAt: [0.12, 0.5, 0], offset: [1.5, 0.75, 2] })
  })
})

describe('save view as (docs/scene-files.md)', () => {
  const v = { lookAt: [0.1, 0.5, 0] as [number, number, number], offset: [1.234, 0.5, 2] as [number, number, number] }
  const slides = (camera: string) => `---\nid: a\nscene: arm\n${camera}# note\n---\n# A\n---\nscene: arm\n---\n# B\n`

  it('gives a slide that names a view a block of its own ("only this slide")', () => {
    const out = setCameraView(slides('camera: overview   # the usual\n'), 0, v)
    expect(out).toBe(slides('camera:\n  lookAt: [0.1, 0.5, 0]\n  offset: [1.23, 0.5, 2]\n'))
  })

  it('makes a slide use a view by name, replacing a block or another name, or adding the line', () => {
    expect(setCameraName(slides('camera:\n  lookAt: [0, 0, 0]\n  offset: [1, 1, 1]\n'), 0, 'nært')).toBe(slides('camera: nært\n'))
    expect(setCameraName(slides('camera: { offset: [1, 1, 1] }   # flow\n'), 0, 'nært')).toBe(slides('camera: nært   # flow\n'))
    expect(setCameraName(slides('camera: overview\n'), 0, 'nært')).toBe(slides('camera: nært\n'))
    expect(setCameraName(slides(''), 1, 'nært')).toBe(slides('').replace('---\nscene: arm\n---\n# B', '---\nscene: arm\ncamera: nært\n---\n# B'))
    const windows = slides('camera:\n  offset: [1, 1, 1]\n').replace(/\n/g, '\r\n')
    expect(setCameraName(windows, 0, 'nært')).toBe(slides('camera: nært\n').replace(/\n/g, '\r\n'))
  })

  it('adds a view to a scene file, written like its other views', () => {
    const scene = 'base: arm   # the arm\n\nviews:\n    overview:      # wide\n        lookAt: [0, 0, 0]\n        offset: [1, 1, 1]\n# end\n'
    const out = addNamedView(scene, 'nært', v)
    expect(out).toBe(
      'base: arm   # the arm\n\nviews:\n    overview:      # wide\n        lookAt: [0, 0, 0]\n        offset: [1, 1, 1]\n' +
        '    nært:\n        lookAt: [0.1, 0.5, 0]\n        offset: [1.23, 0.5, 2]\n# end\n',
    )
    expect(readSceneFiles({ 'scenes/arm.yaml': out }).get('arm')!.views.get('nært')!.camera).toEqual({ lookAt: [0.1, 0.5, 0], offset: [1.23, 0.5, 2] })
  })

  it('adds views: when the file has none, or fills an empty one, keeping Windows line endings', () => {
    expect(addNamedView('base: arm\n', 'a', v)).toBe('base: arm\n\nviews:\n  a:\n    lookAt: [0.1, 0.5, 0]\n    offset: [1.23, 0.5, 2]\n')
    expect(addNamedView('base: arm\r\nviews:\r\n# later\r\n', 'a', { lookAt: 'tool0', offset: [1, 1, 1] })).toBe(
      'base: arm\r\nviews:\r\n  a:\r\n    lookAt: tool0\r\n    offset: [1, 1, 1]\r\n# later\r\n',
    )
    expect(addNamedView('base: arm\nviews: { o: { lookAt: [0, 0, 0], offset: [1, 1, 1] } }\n', 'a', v)).toBe(
      'base: arm\nviews: { o: { lookAt: [0, 0, 0], offset: [1, 1, 1] }, a: { lookAt: [0.1, 0.5, 0], offset: [1.23, 0.5, 2] } }\n',
    )
    expect(() => addNamedView('base: arm\nviews:\n  a:\n    lookAt: [0, 0, 0]\n    offset: [1, 1, 1]\n', 'a', v)).toThrow(/already has a view 'a'/)
  })

  it('writes a new scene file the compiler reads', () => {
    const text = newSceneFile('pendulum', 'nært', { lookAt: 'bob', offset: [0.9, 0.1, 1.3] })
    const file = readSceneFiles({ 'scenes/pendulum.yaml': text }).get('pendulum')!
    expect(file.base).toBe('pendulum')
    expect(file.views.get('nært')!.camera).toEqual({ lookAt: 'bob', offset: [0.9, 0.1, 1.3] })
  })

  it('takes one-word view names that YAML reads as themselves', () => {
    expect(viewNameProblem('nært-2', ['a'])).toBeNull()
    expect(viewNameProblem('', [])).toMatch(/write a name/)
    expect(viewNameProblem('two words', [])).toMatch(/one word/)
    expect(viewNameProblem('2nd', [])).toMatch(/starting with a letter/)
    expect(viewNameProblem('Yes', [])).toMatch(/reads as a value/)
    expect(viewNameProblem('a', ['a'])).toMatch(/already a view called 'a'/)
  })
})

describe('save view as, review cases', () => {
  const files = (_slides: string) => ({ 'scenes/agilus.yaml': 'base: agilus\nviews:\n  top:\n    lookAt: tcp\n    offset: [1, 1, 1]\n' })
  it('keeps an anchor when a slide that names a view gets its own camera', () => {
    const slides =
      '---\nscene: agilus\ncamera:\n  lookAt: [0, 0, 0]\n  offset: [5, 5, 5]\n---\n# A\n' +
      '---\nscene: agilus\ncamera: top\n---\n# B\n' +
      '---\nscene: agilus\n---\n# C\n'
    const out = setCameraView(slides, 1, { lookAt: 'tcp', offset: [0.4, 0.2, 0.5] })
    const compiled = compileSlides(out, files(out))
    expect(compiled[1].effective.camera).toEqual({ lookAt: 'tcp', offset: [0.4, 0.2, 0.5] })
    expect(compiled[2].effective.camera).toEqual({ lookAt: 'tcp', offset: [0.4, 0.2, 0.5] })
  })

  it('replaces a name written on the next line, or as a block scalar', () => {
    for (const camera of ['camera:\n  top\n', 'camera: >-\n  top\n']) {
      const out = setCameraView(`---\nscene: agilus\n${camera}joints: {}\n---\n# B\n`, 0, { lookAt: [0, 0, 0], offset: [1, 2, 3] })
      expect(out).toBe('---\nscene: agilus\ncamera:\n  lookAt: [0, 0, 0]\n  offset: [1, 2, 3]\njoints: {}\n---\n# B\n')
    }
  })

  it('writes a view name that YAML would misread in quotes', () => {
    const out = setCameraName('---\nscene: agilus\n---\n# B\n', 0, '45')
    expect(out).toBe('---\nscene: agilus\ncamera: "45"\n---\n# B\n')
    expect(setCameraName('---\nscene: agilus\n---\n# B\n', 0, 'x #1')).toContain('camera: "x #1"')
  })

  it('fills views: ~ or views: null, keeping a comment', () => {
    const v = { lookAt: [0, 0, 0] as [number, number, number], offset: [1, 1, 1] as [number, number, number] }
    for (const text of ['base: agilus\nviews: ~\n', 'base: agilus\nviews: null   # none yet\n']) {
      const out = addNamedView(text, 'ny', v)
      expect(readSceneFiles({ 'scenes/agilus.yaml': out }).get('agilus')!.views.get('ny')!.camera).toEqual({ lookAt: [0, 0, 0], offset: [1, 1, 1] })
    }
    expect(addNamedView('base: agilus\nviews: null   # none yet\n', 'ny', v)).toContain('views:   # none yet\n  ny:\n')
  })

  it('leaves comment lines under the last view with it', () => {
    const scene = 'views:\n  a:\n    lookAt: tcp\n    offset: [1, 1, 1]\n    # spring: { omega: 3 }\n\nbase: agilus\n'
    const out = addNamedView(scene, 'ny', { lookAt: [0, 0, 0], offset: [2, 2, 2] })
    expect(out).toBe(
      'views:\n  a:\n    lookAt: tcp\n    offset: [1, 1, 1]\n    # spring: { omega: 3 }\n  ny:\n    lookAt: [0, 0, 0]\n    offset: [2, 2, 2]\n\nbase: agilus\n',
    )
  })
})

describe('save view as, second review', () => {
  const scene = 'base: arm\nviews:\n  oversikt:\n    lookAt: [0, 0.5, 0]\n    offset: [2, 2, 2]\n  verktøy:\n    lookAt: gripper\n    offset: [1, 1, 1]\n'

  it("writes an anchor into another view, replacing that view's lookAt", () => {
    const out = setNamedView(scene, 'oversikt', { lookAt: 'gripper', offset: [0.5, 0.5, 0.5] })
    expect(readSceneFiles({ 'scenes/arm.yaml': out }).get('arm')!.views.get('oversikt')!.camera).toEqual({ lookAt: 'gripper', offset: [0.5, 0.5, 0.5] })
    // the view that already looks at it keeps its lookAt as written
    expect(setNamedView(scene, 'verktøy', { lookAt: 'gripper', offset: [2, 1, 1] })).toBe(scene.replace('offset: [1, 1, 1]', 'offset: [2, 1, 1]'))
  })

  it("gives a new view the slide's spring, so the slide flies as before", () => {
    const v = { lookAt: [0, 0.45, 0] as [number, number, number], offset: [2.2, 1.3, 2.2] as [number, number, number], spring: { omega: 4, zeta: 0.5 } }
    const added = addNamedView(scene, 'demping', v)
    expect(readSceneFiles({ 'scenes/arm.yaml': added }).get('arm')!.views.get('demping')!.camera).toEqual({
      lookAt: [0, 0.45, 0],
      offset: [2.2, 1.3, 2.2],
      spring: { omega: 4, zeta: 0.5 },
    })
    expect(newSceneFile('arm', 'demping', v)).toContain('    spring: { omega: 4, zeta: 0.5 }\n')
    // V and setNamedView never write a spring
    expect(setNamedView(scene, 'oversikt', v)).not.toContain('spring')
  })
})
