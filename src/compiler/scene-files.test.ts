import { describe, expect, it } from 'vitest'
import { compileLecture, compileSlides } from './compile-slides'
import { readSceneFiles } from './scene-files'

const AGILUS = `base: agilus

views:
  oversikt:                  # the whole cell
    lookAt: [-1.1, 0.55, 0]
    offset: [0.6, 1.5, 3.2]
  nært:
    lookAt: [-0.5, 0.62, 0]
    offset: [1.15, 0.72, 2.6]
    spring: { omega: 5, zeta: 1.0 }
  verktøy:
    lookAt: tool0
    offset: [0.4, 0.2, 0.5]
`

describe('readSceneFiles', () => {
  it('reads base and named views, keyed by the scene name', () => {
    const scenes = readSceneFiles({ 'scenes/agilus.yaml': AGILUS, 'slides.md': '# not a scene file', 'images/x.yaml': 'x' })
    expect([...scenes.keys()]).toEqual(['agilus'])
    const agilus = scenes.get('agilus')!
    expect(agilus.base).toBe('agilus')
    expect([...agilus.views.keys()]).toEqual(['oversikt', 'nært', 'verktøy'])
    expect(agilus.views.get('nært')).toEqual({
      camera: { lookAt: [-0.5, 0.62, 0], offset: [1.15, 0.72, 2.6], spring: { omega: 5, zeta: 1.0 } },
      line: 7,
    })
    expect(agilus.views.get('verktøy')!.camera.lookAt).toBe('tool0')
  })

  it('allows a file with only base, and a .yml file', () => {
    expect(readSceneFiles({ 'scenes/arm.yml': 'base: arm\n' }).get('arm')!.views.size).toBe(0)
    expect(readSceneFiles({ 'scenes/arm.yaml': 'base: arm\nviews:\n' }).get('arm')!.views.size).toBe(0)
  })

  it('names the file, the line and what to do', () => {
    const problem = (text: string) => {
      try {
        readSceneFiles({ 'scenes/agilus.yaml': text })
        return 'no error'
      } catch (err) {
        return (err as Error).message
      }
    }
    expect(problem('views:\n  a:\n    lookAt: [0, 0, 0]\n    offset: [1, 1, 1]\n')).toMatch(/^scenes\/agilus\.yaml, line 1: 'base:' is missing/)
    expect(problem('base: agilu\n')).toMatch(/^scenes\/agilus\.yaml, line 1: base 'agilu' is not one of the engine's scenes: arm, pendulum, agilus/)
    expect(problem('base: agilus\nobjekts:\n  table: {}\n')).toMatch(/line 2: unknown key 'objekts'. Did you mean 'objects'\?/)
    expect(problem('base: agilus\nviews:\n  a:\n    lookAt: [0, 0, 0]\n')).toMatch(/line 3: view 'a' has no offset/)
    expect(problem('base: agilus\nviews:\n  a:\n    offset: [0, 0, 0]\n')).toMatch(/line 3: view 'a' has no lookAt/)
    expect(problem('base: agilus\nviews:\n  a:\n    lookAt: [0, 0, 0]\n    distance: 2\n')).toMatch(/line 5: view 'a' has 'distance'/)
    expect(problem('base: agilus\nviews:\n  a:\n    lookAt: [0, 0]\n    offset: [1, 1, 1]\n')).toMatch(/line 4: view 'a' lookAt must be/)
    expect(problem('base: agilus\nviews:\n  a:\n    lookAt: [0, 0, 0]\n    offset: [1, 1, 1]\n    spring: { omega: -1 }\n')).toMatch(/line 6: view 'a' spring\.omega/)
    expect(problem('base: agilus\nviews:\n  a: [1, 2]\n')).toMatch(/line 3: view 'a' is a mapping/)
    expect(problem('base: agilus\nviews:\n  a:\n    lookAt: [0, 0, 0\n')).toMatch(/^scenes\/agilus\.yaml, line \d+:/)
    expect(problem('- base: agilus\n')).toMatch(/line 1: a scene file is a YAML mapping/)
  })

  it('refuses two files for one scene', () => {
    expect(() => readSceneFiles({ 'scenes/arm.yaml': 'base: arm\n', 'scenes/arm.yml': 'base: arm\n' })).toThrow(/both scene 'arm'/)
  })
})

describe('named views in slides', () => {
  const files = { 'scenes/agilus.yaml': AGILUS }
  const slide = (fm: string, body = '# x') => `---\n${fm}\n---\n${body}\n`

  it('turns a name into the whole view, replacing what the slide carried', () => {
    const slides = compileSlides(
      slide('scene: agilus\ncamera:\n  lookAt: [0, 0, 0]\n  offset: [9, 9, 9]\n  spring: { omega: 2 }') +
        slide('scene: agilus\ncamera: oversikt') +
        slide('scene: agilus') +
        slide('scene: agilus\ncamera:\n  offset: [1, 2, 3]'),
      files,
    )
    // the view's own camera, without the spring the first slide set
    expect(slides[1].effective.camera).toEqual({ lookAt: [-1.1, 0.55, 0], offset: [0.6, 1.5, 3.2] })
    // carried forward, and an inline block merges onto it as before
    expect(slides[2].effective.camera).toEqual({ lookAt: [-1.1, 0.55, 0], offset: [0.6, 1.5, 3.2] })
    expect(slides[3].effective.camera).toEqual({ lookAt: [-1.1, 0.55, 0], offset: [1, 2, 3] })
  })

  it("uses the lecture's scene file for its scene name, built on its base", () => {
    const slides = compileSlides(slide('scene: celle\ncamera: oversikt'), { 'scenes/celle.yaml': AGILUS })
    expect(slides[0].scene).toBe('agilus')
    expect(slides[0].effective.camera?.offset).toEqual([0.6, 1.5, 3.2])
  })

  it('says how to make a missing scene file, and suggests a misspelled view', () => {
    expect(() => compileSlides(slide('scene: arm\ncamera: oversikt'), files)).toThrow(
      /slides\.md, line 3: slide 1 names the camera view 'oversikt', but the lecture has no scenes\/arm\.yaml[\s\S]*base: arm\nviews:\n  oversikt:/,
    )
    expect(() => compileSlides(slide('id: a\nscene: agilus\ncamera: oversigt'), files)).toThrow(
      /line 4: slide 1 names the camera view 'oversigt', which scenes\/agilus\.yaml doesn't have\. Did you mean 'oversikt'\?/,
    )
  })

  it('refuses a name on a slide without a scene', () => {
    expect(() => compileSlides(slide('camera: oversikt'), files)).toThrow(/scene-less slide 1 cannot declare/)
  })
})

describe('slide keys', () => {
  it('refuses an unknown key, with the line and the likely one', () => {
    expect(() => compileSlides('---\nid: a\nscene: arm\ncamrea:\n  offset: [1, 1, 1]\n---\n# x\n')).toThrow(
      /slides\.md, line 4: slide 1 has the key 'camrea', which a slide doesn't have\. Did you mean 'camera'\?/,
    )
    expect(() => compileSlides('---\nnotes: hi\n---\n# x\n')).toThrow(/key 'notes'[^?]*A slide's keys are/)
  })
})

describe('scene file rules from review', () => {
  const problem = (files: Record<string, string>, slides = '') => {
    try {
      if (slides) compileSlides(slides, files)
      else readSceneFiles(files)
      return 'no error'
    } catch (err) {
      return (err as Error).message
    }
  }

  it('refuses a file name the editor could not save into, suggesting one', () => {
    expect(problem({ 'scenes/Celle.yaml': 'base: agilus\n' })).toMatch(/scenes\/Celle\.yaml: a scene file's name is lower-case[\s\S]*scenes\/celle\.yaml/)
    expect(problem({ 'scenes/rør_celle.yml': 'base: agilus\n' })).toMatch(/Rename it, for example to scenes\/ror-celle\.yml/)
    expect(problem({ 'scenes/2.yaml': 'base: agilus\n' })).toMatch(/scenes\/2\.yaml: a scene file's name/)
    expect(problem({ 'scenes/robot-celle-2.yaml': 'base: agilus\n' })).toBe('no error')
  })

  it('refuses aliases and merge keys, which would tie views together', () => {
    const shared = 'base: agilus\nviews:\n  a: &v { lookAt: [0, 0, 0], offset: [1, 1, 1] }\n  b: *v\n'
    expect(problem({ 'scenes/agilus.yaml': shared })).toMatch(/line 4: aliases \(\*name\) aren't supported/)
    expect(problem({ 'scenes/agilus.yaml': 'base: agilus\nviews:\n  a:\n    <<: { lookAt: [0, 0, 0] }\n    offset: [1, 1, 1]\n' })).toMatch(
      /line 4: merge keys/,
    )
    expect(problem({ 'scenes/agilus.yaml': 'base:\n' })).toMatch(/line 1: 'base:' is empty or not a name/)
  })

  it('suggests the scene meant when a slide names a view in a scene that does not exist', () => {
    const message = problem({ 'scenes/celle.yaml': 'base: agilus\nviews:\n  o:\n    lookAt: [0, 0, 0]\n    offset: [1, 1, 1]\n' }, '---\nscene: cele\ncamera: o\n---\n# x\n')
    expect(message).toMatch(/scene 'cele', which is neither one of the lecture's scene files nor an engine scene\. Did you mean 'celle'\?/)
    expect(message).not.toMatch(/Create scenes/)
  })

  it('names the scene file in the error for a scene run again after another', () => {
    const files = { 'scenes/celle-a.yaml': 'base: agilus\n', 'scenes/celle-b.yaml': 'base: agilus\n' }
    const slides = '---\nscene: celle-a\n---\n# 1\n---\nscene: arm\n---\n# 2\n---\nscene: celle-b\n---\n# 3\n'
    expect(problem(files, slides)).toMatch(
      /slide 3 uses the scene 'celle-b' \(scenes\/celle-b\.yaml, built on 'agilus'\), which last ran at slide 1, but slide 2 moved on to the scene 'arm' since/,
    )
  })
})

describe('slide key errors from review', () => {
  const problem = (slides: string) => {
    try {
      compileSlides(slides)
      return 'no error'
    } catch (err) {
      return (err as Error).message
    }
  }

  it('finds the line of a quoted or indented key', () => {
    expect(problem('---\nscene: arm\n"camrea": 1\n---\n# x\n')).toMatch(/^slides\.md, line 3: slide 1 has the key 'camrea'/)
    expect(problem('---\n  scene: arm\n  camrea: 1\n---\n# x\n')).toMatch(/^slides\.md, line 3:/)
  })

  it('suggests a key with two letters swapped, and never guesses at one letter', () => {
    expect(problem('---\nsceen: arm\n---\n# x\n')).toMatch(/Did you mean 'scene'\?/)
    expect(problem('---\nidel: {}\n---\n# x\n')).toMatch(/Did you mean 'idle'\?/)
    expect(problem('---\nx: 1\n---\n# x\n')).not.toMatch(/Did you mean/)
  })
})

describe('scene file rules, second round', () => {
  it('refuses an upper-case extension, which the editor and Linux would not find', () => {
    expect(() => readSceneFiles({ 'scenes/arm.YAML': 'base: arm\n' })).toThrow(/scenes\/arm\.YAML: a scene file's name[\s\S]*scenes\/arm\.yaml \(with git mv/)
  })

  it('lists each scene once when suggesting one', () => {
    let message = ''
    try {
      compileSlides('---\nscene: agilsu\ncamera: o\n---\n# x\n', { 'scenes/agilus.yaml': 'base: agilus\n' })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/Did you mean 'agilus'\?/)
    const list = message.slice(message.indexOf('Scenes: ') + 8).replace(/\.$/, '').split(', ')
    expect(new Set(list).size).toBe(list.length)
  })
})

describe('named poses (scene-files-proposal.md step 4)', () => {
  const AGILUS_POSES = `base: agilus
poses:
  q0: [-1.5, -0.5, 1.3, 0.0, 0.7, 0.0]
  qf: [ 1.5, -1.6, 0.4, 0.0, 1.3, 0.0]
  vri: { joint_4: 1.2, joint_6: -0.8 }
`
  const files = { 'scenes/agilus.yaml': AGILUS_POSES }
  const problem = (scene: string, slides = '') => {
    try {
      if (slides) compileSlides(slides, { 'scenes/agilus.yaml': scene })
      else readSceneFiles({ 'scenes/agilus.yaml': scene })
      return 'no error'
    } catch (err) {
      return (err as Error).message
    }
  }

  it('reads a list in joint order, and a mapping of some joints', () => {
    const poses = readSceneFiles(files).get('agilus')!.poses
    expect(poses.get('q0')!.joints).toEqual({ joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0, joint_5: 0.7, joint_6: 0 })
    expect(poses.get('vri')!.joints).toEqual({ joint_4: 1.2, joint_6: -0.8 })
    expect(poses.get('qf')!.line).toBe(4)
  })

  it('sets the joints a pose lists, as a joints: block does, and carries them on', () => {
    const slides = compileSlides(
      '---\nscene: agilus\njoints: q0\n---\n# A\n---\nscene: agilus\njoints: vri\n---\n# B\n---\nscene: agilus\n---\n# C\n',
      files,
    )
    expect(slides[0].effective.joints).toEqual({ joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0, joint_5: 0.7, joint_6: 0 })
    expect(slides[1].effective.joints).toEqual({ joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 1.2, joint_5: 0.7, joint_6: -0.8 })
    expect(slides[2].effective.joints).toEqual(slides[1].effective.joints)
  })

  it('uses poses as the ends of a trajectory', () => {
    const [slide] = compileSlides('---\nscene: agilus\ntrajectory:\n  control: slider\n  from: q0\n  to: qf\n---\n# T\n', files)
    expect(slide.trajectory!.from).toEqual({ joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0, joint_5: 0.7, joint_6: 0 })
    expect(slide.trajectory!.to).toEqual({ joint_1: 1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0, joint_5: 1.3, joint_6: 0 })
    // a mapping pose at one end and a full list at the other don't name the same joints
    expect(() => compileSlides('---\nscene: agilus\ntrajectory:\n  control: slider\n  from: q0\n  to: vri\n---\n# T\n', files)).toThrow(
      "slides.md, line 3: slide 1 trajectory 'from' (the pose 'q0') sets joint_1, joint_2, joint_3, joint_4, joint_5, joint_6, " +
        "but 'to' (the pose 'vri') sets joint_4, joint_6. Both ends must set the same joints: two list poses always do.",
    )
    // a pose at one end and numbers at the other
    expect(() =>
      compileSlides('---\nscene: agilus\ntrajectory:\n  control: slider\n  from: vri\n  to: { joint_4: 0 }\n---\n# T\n', files),
    ).toThrow("trajectory 'from' (the pose 'vri') sets joint_4, joint_6, but 'to' sets joint_4.")
    // numbers at both ends keep the old message
    expect(() =>
      compileSlides('---\nscene: agilus\ntrajectory:\n  control: slider\n  from: { joint_4: 0 }\n  to: { joint_6: 0 }\n---\n# T\n', files),
    ).toThrow(/is in 'from' but not 'to'/)
  })

  it("points an unknown trajectory pose at its own from: or to: line", () => {
    expect(problem(AGILUS_POSES, '---\nscene: agilus\ntrajectory:\n  control: slider\n  from: q0\n  to: qF2\n---\n# T\n')).toMatch(
      /^slides\.md, line 6: slide 1 names the pose 'qF2'/,
    )
    expect(problem(AGILUS_POSES, '---\nscene: agilus\ntrajectory:\n  control: slider\n  from: q9\n  to: qf\n---\n# T\n')).toMatch(
      /^slides\.md, line 5: slide 1 names the pose 'q9'/,
    )
    // the one-line form: its own line is the trajectory's
    expect(problem(AGILUS_POSES, '---\nscene: agilus\ntrajectory: { control: slider, from: q0, to: q7 }\n---\n# T\n')).toMatch(
      /^slides\.md, line 3: slide 1 names the pose 'q7'/,
    )
  })

  it("checks a pose's length, joint names and the robot's limits, naming the line", () => {
    expect(problem('base: agilus\nposes:\n  q0: [0, 0, 0]\n')).toMatch(
      /^scenes\/agilus\.yaml, line 3: pose 'q0' lists 3 values, but 'agilus' has 6 joints: joint_1, joint_2/,
    )
    expect(problem('base: agilus\nposes:\n  q0: [0, 1.2, 0, 0, 0, 0]\n')).toMatch(
      /line 3: pose 'q0' sets joint_2 to 1\.2, outside its limits, -3\.316 to 0\.785 \(radians\)/,
    )
    // limits are shown rounded inward: 3.142 is past the arm's 3.1416, and the message must not say 3.142 is the limit
    let message = ''
    try {
      readSceneFiles({ 'scenes/arm.yaml': 'base: arm\nposes:\n  flip: [3.142, 0, 0]\n' })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toBe("scenes/arm.yaml, line 3: pose 'flip' sets joint1 to 3.142, outside its limits, -3.141 to 3.141 (radians)")
    expect(problem('base: agilus\nposes:\n  q0: { joint_7: 0 }\n')).toMatch(/line 3: pose 'q0' names the joint 'joint_7', which 'agilus' doesn't have/)
    expect(problem('base: agilus\nposes:\n  q0: { joint_1: fast }\n')).toMatch(/line 3: pose 'q0': joint_1 must be a number/)
    expect(problem('base: agilus\nposes:\n  q0: 3\n')).toMatch(/line 3: pose 'q0' is a list of the 6 joint values/)
  })

  it('says how to add a pose, or which poses there are', () => {
    expect(problem('base: agilus\n', '---\nscene: agilus\njoints: q0\n---\n# A\n')).toMatch(
      /slides\.md, line 3: slide 1 names the pose 'q0', which scenes\/agilus\.yaml doesn't have\. It has no poses yet; add them under 'poses:'\./,
    )
    expect(problem(AGILUS_POSES, '---\nscene: agilus\njoints: q1\n---\n# A\n')).toMatch(/Did you mean 'q0'\? Its poses: q0, qf, vri\./)
    let message = ''
    try {
      compileSlides('---\nscene: arm\njoints: rest\n---\n# A\n', {})
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/names the pose 'rest', but the lecture has no scenes\/arm\.yaml[\s\S]*poses:\n  rest: \[0, 0, 0\]   # joint1, joint2, joint3/)
  })
})

describe('objects (scene-files-proposal.md step 6)', () => {
  const CELL = `base: agilus
objects:
  blokk:                     # on the table, written before it
    box: [0.1, 0.1, 0.1]
    at: [0, 0.2, 0]
    parent: hentebord
    material: red
  hentebord:
    box: [0.4, 0.2, 0.4]
    at: [0.05, 0, -0.74]
    rotate: 30
    material: wood
  søyle:
    cylinder: [0.1, 0.5]
    at: [-0.6, 0, 0.3]
    rotate: [0, 0, 90]
  ball: { sphere: 0.08, at: [0.3, 0, 0.4], material: metal }
  verktøyramme:
    frame: 0.1
    parent: tool0
  xA:
    at: [0.29, 0.47, -0.76]
`
  const problem = (text: string, base = 'agilus') => {
    try {
      readSceneFiles({ [`scenes/${base}.yaml`]: text })
      return 'no error'
    } catch (err) {
      return (err as Error).message
    }
  }

  it('reads each shape, with at, rotate, material and parent, parents first', () => {
    const objects = readSceneFiles({ 'scenes/agilus.yaml': CELL }).get('agilus')!.objects
    expect(objects.map((o) => o.name)).toEqual(['hentebord', 'søyle', 'ball', 'verktøyramme', 'xA', 'blokk'])
    expect(objects[0]).toEqual({ name: 'hentebord', shape: 'box', size: [0.4, 0.2, 0.4], at: [0.05, 0, -0.74], rotate: [0, 30, 0], material: 'wood' })
    expect(objects[1]).toEqual({ name: 'søyle', shape: 'cylinder', size: [0.1, 0.5], at: [-0.6, 0, 0.3], rotate: [0, 0, 90], material: 'grey' })
    expect(objects[2]).toEqual({ name: 'ball', shape: 'sphere', size: [0.08], at: [0.3, 0, 0.4], rotate: [0, 0, 0], material: 'metal' })
    expect(objects[3]).toEqual({ name: 'verktøyramme', shape: 'frame', size: [0.1], at: [0, 0, 0], rotate: [0, 0, 0], parent: 'tool0' })
    expect(objects[4]).toEqual({ name: 'xA', shape: 'point', size: [], at: [0.29, 0.47, -0.76], rotate: [0, 0, 0] })
    expect(objects[5]).toMatchObject({ name: 'blokk', parent: 'hentebord', material: 'red' })
  })

  it('gives the lecture its objects by the scene they are in, and only one file per scene may have them', () => {
    const files = { 'scenes/celle.yaml': CELL, 'scenes/agilus.yaml': 'base: agilus\nposes:\n  q0: { joint_1: 0 }\n' }
    const lecture = compileLecture('---\nscene: celle\n---\n# A\n', files)
    expect(Object.keys(lecture.objects)).toEqual(['agilus'])
    expect(lecture.objects.agilus).toHaveLength(6)
    expect(compileLecture('---\nlayout: center\n---\n# A\n', {}).objects).toEqual({})
    expect(() => readSceneFiles({ ...files, 'scenes/agilus.yaml': 'base: agilus\nobjects:\n  p: { at: [0, 0, 0] }\n' })).toThrow(
      /scenes\/agilus\.yaml and scenes\/celle\.yaml both have objects, and both build on 'agilus'/,
    )
    expect(readSceneFiles({ 'scenes/arm.yaml': 'base: arm\nobjects:\n' }).get('arm')!.objects).toEqual([])
  })

  it('names the line and what to do', () => {
    const one = (body: string) => problem(`base: agilus\nobjects:\n  a:\n${body}`)
    expect(one('    position: [0, 0, 0]\n')).toMatch(/^scenes\/agilus\.yaml, line 4: object 'a' has unknown key 'position'\. Did you mean 'at'\?/)
    expect(one('    colour: red\n')).toMatch(/line 4: .*Did you mean 'material'\?/)
    expect(one('    box: [1, 1, 1]\n    size: 2\n')).toMatch(/line 5: object 'a' has 'size': write the size with the shape/)
    expect(one('    box: [1, 1, 1]\n    sphere: 1\n')).toMatch(/line 5: object 'a' has both box and sphere: one shape per object/)
    expect(one('    box: [1, 1]\n')).toMatch(/line 4: object 'a' box must be \[width, height, depth\], in metres/)
    expect(one('    cylinder: [0.1, -1]\n')).toMatch(/line 4: object 'a' cylinder must be \[diameter, height\]/)
    expect(one('    sphere: [0.1]\n')).toMatch(/line 4: object 'a' sphere must be its diameter/)
    expect(one('    frame: 0\n')).toMatch(/line 4: object 'a' frame must be the length of its axes/)
    expect(one('    box: [400, 200, 400]\n')).toMatch(/line 4: object 'a' box has 400, which is 400 m: sizes and places are in metres \(400 mm is 0\.4\)/)
    expect(one('    at: [0, 0]\n')).toMatch(/line 4: object 'a' at must be \[x, y, z\], in metres: the point/)
    expect(one('    box: [1, 1, 1]\n    at: [0, 0, 740]\n')).toMatch(/line 5: object 'a' at has 740/)
    expect(one('    rotate: ninety\n')).toMatch(/line 4: object 'a' rotate must be degrees about y/)
    expect(one('    box: [1, 1, 1]\n    material: tre\n')).toMatch(/line 5: object 'a' material 'tre' isn't one of the colours\. The colours: grey, white/)
    expect(one('    box: [1, 1, 1]\n    material: gray\n')).toMatch(/Did you mean 'grey'\?/)
    expect(one('    frame: 0.1\n    material: red\n')).toMatch(/line 5: object 'a' is a frame, drawn in the axis colours/)
    expect(one('    at: [0, 0, 0]\n    material: red\n')).toMatch(/line 5: object 'a' has no shape, so it is an invisible point/)
    expect(one('    at: [0, 0, 0]\n    parent: a\n')).toMatch(/line 5: object 'a' can't be its own parent/)
    expect(one('    at: [0, 0, 0]\n    parent: tol0\n')).toMatch(
      /line 5: object 'a' has the parent 'tol0', which is neither an object in this file nor an anchor of 'agilus'\. Did you mean 'tool0'\?/,
    )
    expect(one('    at: [0, 0, 0]\n    parent: [b]\n')).toMatch(/line 5: object 'a' parent must be the name of another object/)
    expect(one('')).toMatch(/line 3: object 'a' has nothing in it/)
    expect(one('    {}\n')).toMatch(/object 'a' has nothing in it/)
    expect(problem('base: agilus\nobjects:\n  tool0:\n    frame: 0.1\n')).toMatch(/line 3: object 'tool0' has the name of an anchor of 'agilus' \(base, tool0\)/)
    expect(problem('base: agilus\nobjects:\n  a: { at: [0, 0, 0], parent: b }\n  b: { at: [0, 0, 0], parent: a }\n')).toMatch(
      /line 3: the objects 'a', 'b' hang on each other in a ring/,
    )
    expect(problem('base: agilus\nobjects:\n  - box: [1, 1, 1]\n')).toMatch(/line 3: 'objects' is a mapping/)
    // only the ring, not what hangs on it, and the line of its first object
    expect(problem('base: agilus\nobjects:\n  c: { at: [0, 0, 0], parent: a }\n  a: { at: [0, 0, 0], parent: b }\n  b: { at: [0, 0, 0], parent: a }\n')).toMatch(
      /line 4: the objects 'a', 'b' hang on each other in a ring/,
    )
    // a number in a list written one item per line: its own line
    expect(one('    box:\n      - 0.4\n      - 300\n      - 0.4\n')).toMatch(/line 6: object 'a' box has 300/)
    expect(one('    box:\n      - 0.4\n      - -1\n      - 0.4\n')).toMatch(/line 6: object 'a' box must be/)
    expect(one('    at:\n      - 0\n      - 0\n      - -450\n')).toMatch(/line 7: object 'a' at has -450/)
    expect(one('    at:\n      - 0\n      - 0\n      - abc\n')).toMatch(/line 7: object 'a' at must be \[x, y, z\]/)
    expect(one('    at: [0,\n      0,\n      x]\n')).toMatch(/line 6: object 'a' at must be/)
    expect(one('    rotate:\n      - 0\n      - 0\n      - x\n')).toMatch(/line 7: object 'a' rotate must be/)
    // names and keys a plain JavaScript object already has
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(problem(`base: agilus\nobjects:\n  ${name}:\n    box: [0.1, 0.1, 0.1]\n`)).toMatch(new RegExp(`line 3: object '${name}' has a name JavaScript keeps for itself`))
    }
    expect(one('    constructor: 1\n')).toMatch(/line 4: object 'a' has unknown key 'constructor'\. An object has/)
    expect(problem('base: agilus-duo\nobjects:\n  a:\n    frame: 0.1\n    parent: tool0\n', 'agilus-duo')).toMatch(
      /line 5: object 'a' has the parent 'tool0', but in 'agilus-duo' objects can't hang on the robots/,
    )
    // where no anchor can be a parent, the message offers none
    expect(problem('base: agilus-duo\nobjects:\n  table: { box: [1, 1, 1] }\n  a:\n    frame: 0.1\n    parent: tabel\n', 'agilus-duo')).toBe(
      "scenes/agilus-duo.yaml, line 6: object 'a' has the parent 'tabel', which is not an object in this file. Did you mean 'table'? " +
        "The parent is another object in this file (in 'agilus-duo' objects can't hang on the robots)",
    )
  })

  it("hangs objects on the base scene's own anchors", () => {
    const on = (base: string, parent: string) => readSceneFiles({ [`scenes/${base}.yaml`]: `base: ${base}\nobjects:\n  f: { frame: 0.1, parent: ${parent} }\n` }).get(base)!.objects
    expect(on('arm', 'end_effector')[0].parent).toBe('end_effector')
    expect(on('pendulum', 'bob')[0].parent).toBe('bob')
    expect(on('agilus', 'base')[0].parent).toBe('base')
  })
})

describe('models (scene-files-proposal.md step 8)', () => {
  const ARM = `base: arm
objects:
  table:
    box: [0.4, 0.3, 0.4]
    at: [0.62, 0, -0.69]
    material: wood
  bracket:                            # a part from CAD: STL in millimetres, z up
    model: ../../assets/bracket.stl
    unit: mm
    up: z
    at: [0.1, 0.3, 0.08]
    parent: table
    material: metal
  tray:
    model: models/tray.glb
    at: [-0.1, 0.3, -0.08]
    parent: table
  gripper:
    model: ../../assets/Gripper.STL
    unit: cm
    parent: end_effector
    rotate: [90, 0, 0]
`
  const problem = (text: string) => {
    try {
      readSceneFiles({ 'scenes/arm.yaml': text })
      return 'no error'
    } catch (err) {
      return (err as Error).message
    }
  }
  const one = (body: string) => problem(`base: arm\nobjects:\n  a:\n${body}`)

  it('reads a model as a shape: its file, unit and up, at, rotate, material and parent', () => {
    const objects = readSceneFiles({ 'scenes/arm.yaml': ARM }).get('arm')!.objects
    expect(objects.find((o) => o.name === 'bracket')).toEqual({
      name: 'bracket',
      shape: 'model',
      size: [],
      at: [0.1, 0.3, 0.08],
      rotate: [0, 0, 0],
      material: 'metal',
      parent: 'table',
      model: { src: '../../assets/bracket.stl', unit: 'mm', up: 'z' },
    })
    // without unit, up and material: metres, y up and grey
    expect(objects.find((o) => o.name === 'tray')).toEqual({
      name: 'tray',
      shape: 'model',
      size: [],
      at: [-0.1, 0.3, -0.08],
      rotate: [0, 0, 0],
      material: 'grey',
      parent: 'table',
      model: { src: 'models/tray.glb', unit: 'm', up: 'y' },
    })
    expect(objects.find((o) => o.name === 'gripper')).toMatchObject({ rotate: [90, 0, 0], parent: 'end_effector', model: { unit: 'cm', up: 'y' } })
    // a box has no model
    expect(objects.find((o) => o.name === 'table')).not.toHaveProperty('model')
  })

  it("reports each model with its scene file and the line of its path, in the file's order", () => {
    expect(readSceneFiles({ 'scenes/arm.yaml': ARM }).get('arm')!.models).toEqual([
      { src: '../../assets/bracket.stl', format: 'stl', unit: 'mm', object: 'bracket', file: 'scenes/arm.yaml', line: 8 },
      { src: 'models/tray.glb', format: 'glb', unit: 'm', object: 'tray', file: 'scenes/arm.yaml', line: 15 },
      { src: '../../assets/Gripper.STL', format: 'stl', unit: 'cm', object: 'gripper', file: 'scenes/arm.yaml', line: 19 },
    ])
    expect(readSceneFiles({ 'scenes/arm.yaml': 'base: arm\nobjects:\n  b: { box: [1, 1, 1] }\n' }).get('arm')!.models).toEqual([])
    expect(readSceneFiles({ 'scenes/arm.yaml': 'base: arm\n' }).get('arm')!.models).toEqual([])
  })

  it('refuses anything but a path as the model, naming its line (C1)', () => {
    const c1 =
      "object 'a' model must be the path of an .stl or .glb file from the lecture folder (where slides.md is), such as models/bracket.stl, " +
      "or ../../assets/bracket.stl for one in the course's assets/ folder"
    expect(one('    model: 3\n')).toBe(`scenes/arm.yaml, line 4: ${c1}`)
    expect(one('    model: ""\n')).toBe(`scenes/arm.yaml, line 4: ${c1}`)
    expect(one('    model: [a.stl]\n')).toBe(`scenes/arm.yaml, line 4: ${c1}`)
    expect(one('    at: [0, 0, 0]\n    model:\n')).toMatch(/^scenes\/arm\.yaml, line 5: object 'a' model must be the path of an \.stl or \.glb file/)
  })

  it('checks the path as written, naming its line (C2-C7)', () => {
    expect(one('    at: [0, 0, 0]\n    model: C:/Users/adam/bracket.stl\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' model 'C:/Users/adam/bracket.stl' is an absolute path on this computer: copy the file into the " +
        "lecture folder (for example models/) or the course's assets/ folder, and give the path from the lecture folder",
    )
    expect(one('    model: https://example.com/bracket.stl\n')).toMatch(/^scenes\/arm\.yaml, line 4: object 'a' model 'https:\/\/example\.com\/bracket\.stl' is a web address\. /)
    expect(one('    model: models\\bracket.stl\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a' model 'models\\bracket.stl' contains a backslash: use /, such as models/bracket.stl",
    )
    expect(one('    model: /models/bracket.stl\n')).toMatch(/line 4: object 'a' model '\/models\/bracket\.stl' starts with '\/'/)
    expect(one('    model: models/tray.gltf\n')).toMatch(/line 4: object 'a' model 'models\/tray\.gltf' is glTF as text/)
    expect(one('    model: models/bracket.step\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a' model 'models/bracket.step' isn't a file a lecture can show: export it from the CAD program as .stl (binary) or .glb",
    )
    // a name VS Code's panel won't read, which the build would: said at the line, so both agree
    expect(one('    at: [0, 0, 0]\n    model: .cad/bracket.stl\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' model '.cad/bracket.stl' has a folder name starting with '.' ('.cad'), which VS Code's panel won't read: rename the folder",
    )
    expect(one('    model: models/bracket~1.stl\n')).toMatch(/^scenes\/arm\.yaml, line 4: object 'a' model 'models\/bracket~1\.stl' has a file name with ~ and a digit/)
    expect(one('    model: "models/a:b.stl"\n')).toMatch(/^scenes\/arm\.yaml, line 4: object 'a' model 'models\/a:b\.stl' has a file name with a colon/)
  })

  it('allows unit and up only with a model (C8)', () => {
    expect(one('    box: [1, 1, 1]\n    unit: mm\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' has unit, which says what a model's file is measured in: a box's size is in metres already",
    )
    expect(one('    cylinder: [0.1, 0.2]\n    up: z\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' has up, which says which axis is up in a model's file: a shape is built with y up",
    )
    expect(one('    at: [0, 0, 0]\n    unit: mm\n')).toMatch(/line 5: object 'a' has unit, .*: a shape's size is in metres already/)
  })

  it('checks unit, guessing the unit meant (C9)', () => {
    const c9 = "isn't one of mm, cm or m: what the file is measured in (without unit, m)."
    expect(one('    model: x.stl\n    unit: millimetre\n')).toBe(`scenes/arm.yaml, line 5: object 'a' unit 'millimetre' ${c9} Did you mean 'mm'?`)
    expect(one('    model: x.stl\n    unit: centimeters\n')).toMatch(/unit 'centimeters' .* Did you mean 'cm'\?$/)
    expect(one('    model: x.stl\n    unit: meter\n')).toMatch(/Did you mean 'm'\?$/)
    expect(one('    model: x.stl\n    unit: MM\n')).toMatch(/Did you mean 'mm'\?$/)
    expect(one('    model: x.stl\n    unit: inch\n')).toBe(`scenes/arm.yaml, line 5: object 'a' unit 'inch' ${c9}`)
    expect(one('    model: x.stl\n    unit: 1000\n')).toBe(`scenes/arm.yaml, line 5: object 'a' unit '1000' ${c9}`)
  })

  it('checks up (C10)', () => {
    const c10 = 'up must be the axis that is up in the file, y or z; without up, y; ROS meshes and many CAD programs have z up'
    expect(one('    model: x.stl\n    up: x\n')).toBe(`scenes/arm.yaml, line 5: object 'a' ${c10}`)
    expect(one('    model: x.stl\n    up: Z\n')).toBe(`scenes/arm.yaml, line 5: object 'a' ${c10}`)
    expect(one('    model: x.stl\n    up: [0, 0, 1]\n')).toBe(`scenes/arm.yaml, line 5: object 'a' ${c10}`)
  })

  it('says a model takes its size from its file, not from scale (C11)', () => {
    expect(one('    model: x.stl\n    scale: 0.001\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' has 'scale': a shape's size is written with it (box: [0.4, 0.2, 0.4]), and a model's comes from its file: " +
        'give unit: mm for a file measured in millimetres',
    )
  })

  it('allows one shape per object, a model being one (C12)', () => {
    expect(one('    box: [1, 1, 1]\n    model: x.stl\n')).toBe("scenes/arm.yaml, line 5: object 'a' has both box and model: one shape per object")
    // named in the order of the shapes, at the line of the second, as for any two shapes
    expect(one('    model: x.stl\n    frame: 0.1\n')).toBe("scenes/arm.yaml, line 4: object 'a' has both frame and model: one shape per object")
  })

  it("offers 'model', 'unit' and 'up' for the words other tools use", () => {
    for (const key of ['mesh', 'stl', 'glb', 'STL']) expect(one(`    ${key}: x.stl\n`)).toMatch(new RegExp(`line 4: object 'a' has unknown key '${key}'\\. Did you mean 'model'\\?`))
    expect(one('    model: x.stl\n    units: mm\n')).toMatch(/line 5: object 'a' has unknown key 'units'\. Did you mean 'unit'\?/)
    for (const key of ['up_axis', 'upAxis']) expect(one(`    model: x.stl\n    ${key}: z\n`)).toMatch(new RegExp(`has unknown key '${key}'\\. Did you mean 'up'\\?`))
  })

  it('lists a model with the shapes, wherever the messages list them', () => {
    expect(one('')).toBe(
      "scenes/arm.yaml, line 3: object 'a' has nothing in it: give it a shape (box, cylinder, sphere or frame) or a model (model: models/x.stl) " +
        'and where it is, at: [x, y, z]. With only at, it is an invisible point',
    )
    expect(problem('base: arm\nobjects:\n  a: x.stl\n')).toBe(
      "scenes/arm.yaml, line 3: object 'a' is a mapping: a shape (box, cylinder, sphere or frame) or a model (model: models/x.stl) and where it is, at: [x, y, z]",
    )
    expect(one('    model: x.stl\n    colour: red\n')).toBe(
      "scenes/arm.yaml, line 5: object 'a' has unknown key 'colour'. Did you mean 'material'? An object has a shape (box, cylinder, sphere or frame) " +
        'or a model (model: models/x.stl), at, rotate, material and parent; a model also has unit and up',
    )
  })

  it("checks at, rotate, material and parent as for any shape, with a shape's wording for at", () => {
    expect(one('    model: x.stl\n    at: [0, 0]\n')).toBe("scenes/arm.yaml, line 5: object 'a' at must be [x, y, z], in metres: the middle of its underside")
    expect(one('    model: x.stl\n    at: [0, 0, 740]\n')).toMatch(/line 5: object 'a' at has 740/)
    expect(one('    model: x.stl\n    material: gold\n')).toMatch(/line 5: object 'a' material 'gold' isn't one of the colours/)
    expect(one('    model: x.stl\n    parent: tabel\n')).toMatch(/line 5: object 'a' has the parent 'tabel'/)
    // a model is a parent and an anchor like any object
    const objects = readSceneFiles({ 'scenes/arm.yaml': 'base: arm\nobjects:\n  cup: { sphere: 0.05, parent: tray }\n  tray: { model: tray.glb }\n' }).get('arm')!.objects
    expect(objects.map((o) => o.name)).toEqual(['tray', 'cup'])
  })
})
