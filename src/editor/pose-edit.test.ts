import { describe, expect, it } from 'vitest'
import { compileSlides } from '../compiler/compile-slides'
import {
  motionOf,
  namedPoseEdit,
  poseEdit,
  poseTarget,
  poseUsers,
  poseValue,
  sceneJoints,
  setNamedPose,
  setSlideJoints,
} from './pose-edit'

const apply = (text: string, e: { start: number; end: number; text: string }) => text.slice(0, e.start) + e.text + text.slice(e.end)
const ARM = ['joint1', 'joint2', 'joint3']

describe('setSlideJoints', () => {
  it("sets a block's joints where they stand and adds the others after them", () => {
    const src = '---\nscene: arm\njoints:\n  joint2: 0.3   # low\ncamera: overview\n---\n# A\n'
    expect(setSlideJoints(src, 0, { joint2: 0.5, joint1: -1 })).toBe(
      '---\nscene: arm\njoints:\n  joint2: 0.5   # low\n  joint1: -1\ncamera: overview\n---\n# A\n',
    )
  })

  it('writes into a flow mapping, keeping its form', () => {
    const src = '---\nscene: arm\njoints: { joint2: 0.3 }\n---\n# A\n'
    expect(setSlideJoints(src, 0, { joint2: 0.5, joint3: 1.2 })).toBe('---\nscene: arm\njoints: { joint2: 0.5, joint3: 1.2 }\n---\n# A\n')
  })

  it('adds a block to a slide without joints, or with an empty joints:', () => {
    expect(setSlideJoints('---\nscene: arm\n---\n# A\n', 0, { joint1: 0.25 })).toBe('---\nscene: arm\njoints:\n  joint1: 0.25\n---\n# A\n')
    expect(setSlideJoints('---\nscene: arm\njoints:\nid: a\n---\n# A\n', 0, { joint1: 0.25 })).toBe(
      '---\nscene: arm\njoints:\n  joint1: 0.25\nid: a\n---\n# A\n',
    )
  })

  it('touches only the slide asked for, keeping CRLF line endings', () => {
    const src = '---\r\nscene: arm\r\n---\r\n# A\r\n---\r\nscene: arm\r\njoints:\r\n  joint1: 0\r\n---\r\n# B\r\n'
    expect(setSlideJoints(src, 1, { joint1: 0.7 })).toBe(src.replace('joint1: 0', 'joint1: 0.7'))
  })

  it('keeps a blank line before the closing fence when it adds a joint', () => {
    expect(setSlideJoints('---\nscene: arm\njoints:\n  joint2: 0.3\n\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:\n  joint2: 0.3\n  joint1: 1\n\n---\n# A\n',
    )
  })

  it("keeps comments around a null on a later line, and drops a tag or an anchor on the empty value", () => {
    expect(setSlideJoints('---\nscene: arm\njoints:\n  # c\n  ~\nid: a\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:\n  # c\n  joint1: 1\nid: a\n---\n# A\n',
    )
    expect(setSlideJoints('---\nscene: arm\njoints:\n  ~ # c\nid: a\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:\n  # c\n  joint1: 1\nid: a\n---\n# A\n',
    )
    for (const empty of ['!!null', '!!null ~', '&a ~']) {
      expect(setSlideJoints(`---\nscene: arm\njoints: ${empty}   # c\n---\n# A\n`, 0, { joint1: 1 })).toBe(
        '---\nscene: arm\njoints:   # c\n  joint1: 1\n---\n# A\n',
      )
    }
  })

  it('keeps a comment on an empty joints: line, and drops a null', () => {
    expect(setSlideJoints('---\nscene: arm\njoints:   # later\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:   # later\n  joint1: 1\n---\n# A\n',
    )
    expect(setSlideJoints('---\nscene: arm\njoints: ~   # none yet\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:   # none yet\n  joint1: 1\n---\n# A\n',
    )
    expect(setSlideJoints('---\nscene: arm\njoints:\n  null\nid: a\n---\n# A\n', 0, { joint1: 1 })).toBe(
      '---\nscene: arm\njoints:\n  joint1: 1\nid: a\n---\n# A\n',
    )
  })

  it('refuses a joint written with a tag or an anchor, and writes over an alias', () => {
    expect(() => setSlideJoints('---\nscene: arm\njoints:\n  joint2: !!int 1\n---\n# A\n', 0, { joint2: 0.5 })).toThrow(
      "joint2 isn't written as a plain number",
    )
    const shared = '---\nscene: arm\njoints:\n  joint1: &up 0.5\n  joint2: *up\n---\n# A\n'
    expect(() => setSlideJoints(shared, 0, { joint1: 1 })).toThrow("joint1 isn't written as a plain number")
    expect(setSlideJoints(shared, 0, { joint2: 1 })).toBe(shared.replace('joint2: *up', 'joint2: 1'))
  })

  it('refuses a slide that names a pose, or whose joints: is not a mapping', () => {
    expect(() => setSlideJoints('---\nscene: arm\njoints: reach\n---\n# A\n', 0, { joint1: 0 })).toThrow("this slide names the pose 'reach'")
    expect(() => setSlideJoints('---\nscene: arm\njoints: [1, 2]\n---\n# A\n', 0, { joint1: 0 })).toThrow('not a mapping')
  })
})

describe('setNamedPose', () => {
  const FILE = 'base: arm\nposes:\n  reach: [0.9, 1.1, -1.5]    # every joint\n  low: { joint2: 0.3 }\n  tall:\n    - 0\n    - 0.2   # up\n    - 0\n'

  it("replaces a list's numbers where they stand", () => {
    expect(setNamedPose(FILE, 'reach', { joint2: 0.75 }, ARM)).toBe(FILE.replace('[0.9, 1.1, -1.5]', '[0.9, 0.75, -1.5]'))
    expect(setNamedPose(FILE, 'tall', { joint1: -0.5, joint2: 0.4 }, ARM)).toBe(
      FILE.replace('    - 0\n    - 0.2', '    - -0.5\n    - 0.4'),
    )
  })

  it('sets or adds the joints of a mapping pose', () => {
    expect(setNamedPose(FILE, 'low', { joint2: 0.4, joint1: 1 }, ARM)).toBe(FILE.replace('{ joint2: 0.3 }', '{ joint2: 0.4, joint1: 1 }'))
  })

  it('keeps CRLF and a byte-order mark', () => {
    const crlf = '\uFEFF' + FILE.replace(/\n/g, '\r\n')
    expect(setNamedPose(crlf, 'reach', { joint3: -1 }, ARM)).toBe(crlf.replace('-1.5]', '-1]'))
  })

  it('keeps the final newline, or its absence, adding a joint to the last pose', () => {
    const last = 'base: arm\nposes:\n  low:\n    joint2: 0.3\n'
    expect(setNamedPose(last, 'low', { joint1: 0.1 }, ARM)).toBe(`${last}    joint1: 0.1\n`)
    expect(setNamedPose(last.replace(/\n/g, '\r\n'), 'low', { joint1: 0.1 }, ARM)).toBe(`${last}    joint1: 0.1\n`.replace(/\n/g, '\r\n'))
    expect(setNamedPose(last.trimEnd(), 'low', { joint1: 0.1 }, ARM)).toBe(`${last}    joint1: 0.1`)
  })

  it('finds the slides that carry a pose with a tagged joint', () => {
    const lecture = {
      'slides.md': '---\nscene: arm\njoints: low\n---\n# A\n---\nscene: arm\n---\n# B\n',
      'scenes/arm.yaml': 'base: arm\nposes:\n  low: { joint2: !!float 0.3 }\n',
    }
    const shown = compileSlides(lecture['slides.md'], lecture).map(motionOf)
    expect(poseUsers(lecture, { pose: 'low', path: 'scenes/arm.yaml', users: [0] }, shown)).toEqual([0, 1])
  })

  it('refuses a mapping pose joint written with a tag', () => {
    expect(() => setNamedPose('base: arm\nposes:\n  low: { joint2: !!float 0.3 }\n', 'low', { joint2: 1 }, ARM)).toThrow('tag or an anchor')
  })

  it("refuses a pose that isn't there, or isn't plain numbers", () => {
    expect(() => setNamedPose(FILE, 'gone', { joint1: 0 }, ARM)).toThrow("no pose 'gone'")
    expect(() => setNamedPose('base: arm\nposes:\n  a: [0, !!float 1, 0]\n', 'a', { joint2: 0 }, ARM)).toThrow('plain numbers')
    expect(() => setNamedPose('base: arm\nposes:\n  a: [0, 1]\n', 'a', { joint2: 0 }, ARM)).toThrow('lists 2 values')
  })

  it('is no edit when the pose has the values already', () => {
    expect(namedPoseEdit(FILE, 'reach', { joint1: 0.9 }, ARM)).toBeNull()
  })
})

describe('poseValue', () => {
  it('rounds to two decimals, inside the limits rounded inward', () => {
    const [joint1] = sceneJoints('arm') // ±3.1416
    expect(poseValue(0.123456, joint1)).toBe(0.12)
    expect(poseValue(3.1416, joint1)).toBe(3.14)
    expect(poseValue(-3.1416, joint1)).toBe(-3.14)
    expect(poseValue(-0.001, joint1)).toBe(0)
    expect(Object.is(poseValue(-0.001, joint1), 0)).toBe(true)
    const joint2 = sceneJoints('agilus')[1] // -3.316… to 0.7853981625
    expect(poseValue(0.7853981625, joint2)).toBe(0.78)
    expect(poseValue(-3.316125575, joint2)).toBe(-3.31)
  })

  it('knows the joints of the engine scenes only', () => {
    expect(sceneJoints('arm').map((j) => j.name)).toEqual(ARM)
    expect(sceneJoints('nope')).toEqual([])
  })
})

describe('poseEdit and poseTarget', () => {
  const slides = '---\nscene: arm\njoints: reach\n---\n# A\n---\nscene: arm\n---\n# B\n---\nscene: arm\njoints: reach\n---\n# C\n'
  const files = { 'slides.md': slides, 'scenes/arm.yaml': 'base: arm\nposes:\n  reach: [0.9, 1.1, -1.5]\n' }

  it('finds the pose a slide names, and the slides that name it', () => {
    expect(poseTarget(files, 0)).toEqual({ pose: 'reach', path: 'scenes/arm.yaml', users: [0, 2] })
    expect(poseTarget(files, 1)).toBeNull()
    // no scene file: P writes into the slide (the build then says the pose is missing)
    expect(poseTarget({ 'slides.md': slides }, 0)).toBeNull()
  })

  it('writes into the slide shown, found in the current text', () => {
    const current = '---\nid: new\n---\n# New\n' + slides
    const e = poseEdit(slides, current, 1, { joint1: 0.5 })
    expect(apply(current, e as { start: number; end: number; text: string })).toBe(
      current.replace('scene: arm\n---\n# B', 'scene: arm\njoints:\n  joint1: 0.5\n---\n# B'),
    )
    expect(poseEdit(slides, slides.replace('# B', '# B, edited'), 1, { joint1: 0.5 })).toHaveProperty('problem')
  })

  it('finds every slide whose robot a pose moves: those that name it and those that carry it on', () => {
    const lecture = {
      'slides.md':
        '---\nscene: arm\njoints: low\n---\n# A\n---\nscene: arm\n---\n# B\n---\nscene: arm\njoints: { joint2: 0 }\n---\n# C\n' +
        '---\nscene: arm\ntrajectory:\n  control: slider\n  from: reach\n  to: { joint1: 0, joint2: 0, joint3: 0 }\n---\n# D\n',
      'scenes/arm.yaml': 'base: arm\nposes:\n  reach: [0.9, 1.1, -1.5]\n  low: { joint2: 0.3 }\n',
    }
    const shown = compileSlides(lecture['slides.md'], lecture).map(motionOf)
    expect(poseUsers(lecture, { pose: 'low', path: 'scenes/arm.yaml', users: [0] }, shown)).toEqual([0, 1])
    expect(poseUsers(lecture, { pose: 'reach', path: 'scenes/arm.yaml', users: [] }, shown)).toEqual([3])
  })
})
