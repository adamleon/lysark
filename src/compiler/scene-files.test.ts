import { describe, expect, it } from 'vitest'
import { compileSlides } from './compile-slides'
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
    expect(problem('base: agilus\nposes:\n  q0: [0, 0, 0, 0, 0, 0]\n')).toMatch(/line 2: unknown key 'poses'/)
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
