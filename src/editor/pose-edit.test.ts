import { describe, expect, it } from 'vitest'
import { compileSlides } from '../compiler/compile-slides'
import { readSceneFiles } from '../compiler/scene-files'
import { setSlideName } from './camera-edit'
import {
  addNamedPose,
  motionOf,
  namedPoseEdit,
  newPoseSceneFile,
  poseAsChanges,
  poseAsChoices,
  poseEdit,
  poseJointValue,
  poseTarget,
  poseUsers,
  poseValue,
  sceneJoints,
  setNamedPose,
  setSlideJoints,
  type PoseAsChanges,
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

describe('save pose as (Shift+P)', () => {
  const SCENE = 'base: arm\nposes:\n  reach: [0.9, 1.1, -1.5]\n  low: { joint2: 0.3 }   # only joint2\n'
  const SLIDES =
    '---\nscene: arm\njoints: low\n---\n# A\n' + // slide 1 names a mapping pose
    '---\nscene: arm\njoints:\n  joint1: 0.2\n---\n# B\n' + // slide 2 has a block of its own
    '---\nscene: arm\n---\n# C\n' // slide 3 carries
  const files = { 'slides.md': SLIDES, 'scenes/arm.yaml': SCENE }
  const none = () => [] as number[]
  const changes = (slide: number, choice: Parameters<typeof poseAsChanges>[4], robot: Record<string, number>, moved: string[], f: Record<string, string> = files) => {
    const choices = poseAsChoices(f, slide, none)!
    return poseAsChanges(f['slides.md'], { slides: f['slides.md'], scene: f['scenes/arm.yaml'] ?? null }, slide, choices, choice, robot, moved)
  }
  /** the files with the changes applied */
  const after = (plan: PoseAsChanges | { problem: string }, f: Record<string, string> = files) => {
    if ('problem' in plan) throw new Error(plan.problem)
    const out = { ...f }
    if (plan.slides) out['slides.md'] = apply(f['slides.md'], plan.slides)
    if (plan.scene) out['scenes/arm.yaml'] = apply(f['scenes/arm.yaml'], plan.scene)
    if (plan.create) out['scenes/arm.yaml'] = plan.create
    return out
  }
  /** the joints each slide shows, scene defaults included, as the engine puts them */
  const shows = (f: Record<string, string>) =>
    compileSlides(f['slides.md'], f).map((s) => ({ joint1: 0, joint2: 0.6, joint3: -1, ...s.effective.joints }))

  it('knows what the slide sets itself, and the poses with their joints', () => {
    expect(poseAsChoices(files, 0, none)).toMatchObject({ scene: 'arm', base: 'arm', current: 'low', own: ['joint2'] })
    expect(poseAsChoices(files, 1, none)).toMatchObject({ current: null, own: ['joint1'] })
    expect(poseAsChoices(files, 2, none)!.poses).toEqual([
      { name: 'reach', joints: ['joint1', 'joint2', 'joint3'], users: [] },
      { name: 'low', joints: ['joint2'], users: [] },
    ])
    // no scene file: a new pose makes one
    expect(poseAsChoices({ 'slides.md': '---\nscene: arm\n---\n# A\n' }, 0, none)).toMatchObject({ exists: false, path: 'scenes/arm.yaml', poses: [] })
  })

  // the robot on slide 1 shows joint1 0, joint2 0.3, joint3 -1; joint1 moved to 0.5
  const robot1 = { joint1: 0.5, joint2: 0.3, joint3: -1 }

  it('only this slide: a slide that names a pose gets a block with its joints and the moved ones', () => {
    const plan = changes(0, { kind: 'slide' }, robot1, ['joint1'])
    const next = after(plan)
    expect(next['slides.md']).toContain('---\nscene: arm\njoints:\n  joint2: 0.3\n  joint1: 0.5\n---\n# A')
    expect(next['scenes/arm.yaml']).toBe(SCENE)
    expect(shows(next)[0]).toEqual(robot1)
    expect((plan as PoseAsChanges).written).toEqual({ joint2: 0.3, joint1: 0.5 })
  })

  it('the pose X: the slide names it, and X takes the robot, the joints the slide set included', () => {
    // slide 2 (own block joint1 0.2) shows joint1 0.2, joint2 0.3 (carried from 'low'), joint3 -1; joint3 moved to -0.5
    const robot = { ...shows(files)[1], joint3: -0.5 }
    expect(robot).toEqual({ joint1: 0.2, joint2: 0.3, joint3: -0.5 })
    const next = after(changes(1, { kind: 'pose', name: 'low' }, robot, ['joint3']))
    expect(next['slides.md']).toContain('---\nscene: arm\njoints: low\n---\n# B')
    // joint2's number is right already: left as written
    expect(next['scenes/arm.yaml']).toBe(SCENE.replace('{ joint2: 0.3 }', '{ joint2: 0.3, joint1: 0.2, joint3: -0.5 }'))
    expect(shows(next)[1]).toEqual(robot)
    // slide 1 names 'low' too: it now takes joint1 and joint3 from it (the panel names it)
    expect(shows(next)[0]).toEqual({ joint1: 0.2, joint2: 0.3, joint3: -0.5 })
    // a list pose: every joint
    const list = after(changes(1, { kind: 'pose', name: 'reach' }, robot, ['joint3']))
    expect(list['scenes/arm.yaml']).toBe(SCENE.replace('[0.9, 1.1, -1.5]', '[0.2, 0.3, -0.5]'))
    expect(shows(list)[1]).toEqual(robot)
  })

  it('a new pose: every joint, in order, under poses: or in a new scene file', () => {
    // slide 3 carries slide 2's: joint1 0.2, joint2 0.3, joint3 -1; nothing moved
    const robot = shows(files)[2]
    const next = after(changes(2, { kind: 'new', name: 'q0' }, robot, []))
    expect(next['slides.md']).toContain('---\nscene: arm\njoints: q0\n---\n# C')
    expect(next['scenes/arm.yaml']).toBe(SCENE + '  q0: [0.2, 0.3, -1]\n')
    expect(shows(next)[2]).toEqual(shows(files)[2])
    const bare = { 'slides.md': '---\nscene: arm\n---\n# A\n' }
    const plan = changes(0, { kind: 'new', name: 'q0' }, { joint1: 0.5, joint2: 0.6, joint3: -1 }, ['joint1'], bare)
    const made = after(plan, bare)
    expect((plan as PoseAsChanges).create).toContain('base: arm')
    expect(readSceneFiles({ 'scenes/arm.yaml': made['scenes/arm.yaml'] }).get('arm')!.poses.get('q0')!.joints).toEqual({
      joint1: 0.5,
      joint2: 0.6,
      joint3: -1,
    })
    expect(shows(made)[0]).toEqual({ joint1: 0.5, joint2: 0.6, joint3: -1 })
  })

  it('refuses a name that will not do, and says when nothing changes', () => {
    expect(changes(2, { kind: 'new', name: 'low' }, robot1, [])).toEqual({ problem: "there is already a pose called 'low'" })
    expect(changes(2, { kind: 'new', name: 'yes' }, robot1, [])).toHaveProperty('problem')
    // only this slide, on a slide with its own block, and nothing moved
    expect(changes(1, { kind: 'slide' }, shows(files)[1], [])).toMatchObject({ slides: null, scene: null, create: null })
  })

  it("saves into a mapping pose with a tag or an anchor on a joint whose number stays", () => {
    for (const low of ['{ joint2: !!float 0.3 }', '{ joint2: &a 0.3 }']) {
      const tagged = { ...files, 'scenes/arm.yaml': SCENE.replace('{ joint2: 0.3 }', low) }
      const next = after(changes(0, { kind: 'pose', name: 'low' }, robot1, ['joint1'], tagged), tagged)
      expect(next['scenes/arm.yaml']).toBe(tagged['scenes/arm.yaml'].replace(low, low.replace(' }', ', joint1: 0.5 }')))
    }
  })

  it("refuses 'the pose X' and 'a new pose' on a slide that sets joints a pose can't hold", () => {
    const duo = {
      'slides.md': '---\nscene: agilus-duo\njoints: { joint_1: 0.3, ghost_joint_1: 0.5 }\n---\n# A\n---\nscene: agilus-duo\n---\n# B\n',
      'scenes/agilus-duo.yaml': 'base: agilus-duo\nposes:\n  p: { joint_1: 0.1 }\n',
    }
    const choices = poseAsChoices(duo, 0, none)!
    const robot = { joint_1: 0.3, joint_2: 0, joint_3: 0, joint_4: 0, joint_5: 0, joint_6: 0 }
    for (const choice of [{ kind: 'new', name: 'q1' }, { kind: 'pose', name: 'p' }] as const) {
      const plan = poseAsChanges(duo['slides.md'], { slides: duo['slides.md'], scene: duo['scenes/agilus-duo.yaml'] }, 0, choices, choice, robot, [])
      expect(plan).toEqual({ problem: expect.stringContaining("this slide also sets ghost_joint_1, which a pose of 'agilus-duo' can't hold") })
    }
    // only this slide keeps the block, ghost joint included
    const plan = poseAsChanges(duo['slides.md'], { slides: duo['slides.md'], scene: duo['scenes/agilus-duo.yaml'] }, 0, choices, { kind: 'slide' }, { ...robot, joint_1: 0.4 }, ['joint_1'])
    expect(apply(duo['slides.md'], (plan as PoseAsChanges).slides!)).toContain('joints: { joint_1: 0.4, ghost_joint_1: 0.5 }')
  })

  it('writes a moved joint where the robot holds it, and one not moved as the slide puts it', () => {
    const joint2 = sceneJoints('agilus')[1] // -3.316… to 0.785…
    expect(poseJointValue(joint2, 0.7853981625, 0.7853981625, false)).toBe(0.7853981625) // as written
    expect(poseJointValue(joint2, 0.9, 0.9, false)).toBe(0.78) // past the limit: the limit, rounded inward
    expect(poseJointValue(joint2, 0.123456, undefined, false)).toBe(0.12) // nothing puts it anywhere
    expect(poseJointValue(joint2, 0.123456, 0.5, true)).toBe(0.12) // moved
  })
})

describe('pose text edits for save pose as', () => {
  it("replaces a pose's name with a block: on the key's line, the next, or a block scalar", () => {
    const values = { joint2: 0.3, joint1: 0.5 }
    const block = 'joints:\n  joint2: 0.3\n  joint1: 0.5'
    expect(setSlideJoints('---\nscene: arm\njoints: low   # c\nid: a\n---\n# A\n', 0, values, true)).toBe(
      `---\nscene: arm\n${block.replace('joints:', 'joints:   # c')}\nid: a\n---\n# A\n`,
    )
    expect(setSlideJoints('---\nscene: arm\njoints:\n  low\nid: a\n---\n# A\n', 0, values, true)).toBe(`---\nscene: arm\n${block}\nid: a\n---\n# A\n`)
    expect(setSlideJoints('---\nscene: arm\njoints: >-\n  low\nid: a\n---\n# A\n', 0, values, true)).toBe(`---\nscene: arm\n${block}\nid: a\n---\n# A\n`)
    // and back: a block becomes a name, the comment on its key's line kept
    expect(setSlideName('---\nscene: arm\njoints:   # elbow up\n  joint1: 0.2\nid: a\n---\n# A\n', 0, 'joints', 'weld')).toBe(
      '---\nscene: arm\njoints: weld   # elbow up\nid: a\n---\n# A\n',
    )
    expect(setSlideName('---\nscene: arm\ncamera:   # wide\n  offset: [1, 1, 1]\n---\n# A\n', 0, 'camera', 'overview')).toBe(
      '---\nscene: arm\ncamera: overview   # wide\n---\n# A\n',
    )
    // without replaceName, P refuses it
    expect(() => setSlideJoints('---\nscene: arm\njoints: low\n---\n# A\n', 0, values)).toThrow("names the pose 'low'")
  })

  it('adds a pose under poses:, however the file writes them', () => {
    expect(addNamedPose('base: arm\n', 'q0', [0, 0.6, -1], ARM)).toBe(
      'base: arm\n\nposes:   # radians, every joint in order: joint1, joint2, joint3\n  q0: [0, 0.6, -1]\n',
    )
    expect(addNamedPose('base: arm\nposes:\nviews: {}\n', 'q0', [0, 0.6, -1], ARM)).toBe('base: arm\nposes:\n  q0: [0, 0.6, -1]\nviews: {}\n')
    expect(addNamedPose('base: arm\nposes: { a: [1, 1, 1] }\n', 'q0', [0, 0.6, -1], ARM)).toBe('base: arm\nposes: { a: [1, 1, 1], q0: [0, 0.6, -1] }\n')
    expect(addNamedPose('base: arm\nposes:\n    a: [1, 1, 1]\n      # about a\nviews: {}\n', 'q0', [0, 0.6, -1], ARM)).toBe(
      'base: arm\nposes:\n    a: [1, 1, 1]\n      # about a\n    q0: [0, 0.6, -1]\nviews: {}\n',
    )
    expect(() => addNamedPose('base: arm\nposes:\n  q0: [1, 1, 1]\n', 'q0', [0, 0, 0], ARM)).toThrow("already has a pose 'q0'")
  })

  it('adds a pose to a file with objects, which stay as they are', () => {
    const objects = 'objects:\n  table:\n    box: [0.4, 0.3, 0.4]\n    at: [0.4, 0, -0.45]\n  tool frame: { frame: 0.1, parent: end_effector }\n'
    const before = readSceneFiles({ 'scenes/arm.yaml': `base: arm\nposes:\n  a: [1, 1, 1]\n${objects}` }).get('arm')!.objects
    const among = addNamedPose(`base: arm\nposes:\n  a: [1, 1, 1]\n${objects}`, 'q0', [0, 0.6, -1], ARM)
    expect(among).toBe(`base: arm\nposes:\n  a: [1, 1, 1]\n  q0: [0, 0.6, -1]\n${objects}`)
    const after = addNamedPose(`base: arm\n${objects}`, 'q0', [0, 0.6, -1], ARM)
    expect(after.startsWith(`base: arm\n${objects}`)).toBe(true)
    for (const text of [among, after]) {
      const scene = readSceneFiles({ 'scenes/arm.yaml': text }).get('arm')!
      expect(scene.poses.get('q0')!.joints).toEqual({ joint1: 0, joint2: 0.6, joint3: -1 })
      expect(scene.objects).toEqual(before)
    }
  })

  it('writes a new scene file the compiler reads', () => {
    const text = newPoseSceneFile('agilus', 'grip', [0, -1.25, 0.9, 0, 0.9, 0], sceneJoints('agilus').map((j) => j.name))
    expect(readSceneFiles({ 'scenes/agilus.yaml': text }).get('agilus')!.poses.get('grip')!.joints).toMatchObject({ joint_2: -1.25, joint_6: 0 })
  })

  it('leaves a number already right as written', () => {
    expect(setNamedPose('base: arm\nposes:\n  a: { joint1: 0.0, joint2: 1 }\n', 'a', { joint1: 0, joint2: 2 }, ARM)).toBe(
      'base: arm\nposes:\n  a: { joint1: 0.0, joint2: 2 }\n',
    )
    expect(setNamedPose('base: arm\nposes:\n  a: [0.0, 1, 2]\n', 'a', { joint1: 0, joint2: 5 }, ARM)).toBe('base: arm\nposes:\n  a: [0.0, 5, 2]\n')
  })
})
