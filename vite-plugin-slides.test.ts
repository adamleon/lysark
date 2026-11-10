import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { binaryStl, cylinder, glb, glbEdits, lfsPointer } from './src/scene/model-test-files.js'
import { lectureSceneFiles, resolveFile, resolveImage, slidesPlugin } from './vite-plugin-slides'

let course: string
let lecture: string
let slidesPath: string

beforeAll(() => {
  course = mkdtempSync(join(tmpdir(), 'lysark-images-'))
  lecture = join(course, 'lectures', 'l1')
  mkdirSync(join(lecture, 'images'), { recursive: true })
  mkdirSync(join(course, 'lectures', 'other', 'images'), { recursive: true })
  mkdirSync(join(course, 'assets'), { recursive: true })
  slidesPath = join(lecture, 'slides.md')
  writeFileSync(slidesPath, '')
  writeFileSync(join(lecture, 'images', 'arm.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(lecture, 'images', 'rød robot.jpg'), Buffer.from([0xff, 0xd8]))
  writeFileSync(join(lecture, 'images', 'IMG_1234.JPG'), Buffer.from([0xff, 0xd8]))
  writeFileSync(join(lecture, 'notes.txt'), 'not an image')
  writeFileSync(join(course, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(course, 'lectures', 'other', 'images', 'x.png'), Buffer.from([0x89]))
})

afterAll(() => rmSync(course, { recursive: true, force: true }))

const ref = (src: string) => ({ src, slide: 's3' })
const resolveIn = (src: string) => resolveImage(ref(src), slidesPath, course)

type Transform = (this: unknown, code: string, id: string) => Promise<{ code: string }>
/** the slides module of `md` at `path`, as the build makes it; `watched` gets the files it watches */
async function transform(md: string, path: string, watched: string[] = []): Promise<string> {
  const plugin = slidesPlugin({ courseRoot: course })
  const { code } = await (plugin.transform as Transform).call({ addWatchFile: (f: string) => watched.push(f) }, md, path)
  return code
}
/** the slides module's two exports, by running its code */
function run(code: string): { slides: unknown[]; models: Record<string, string> } {
  const body = code.replace('export const models =', 'const models =').replace('export default', 'return { models, slides: ')
  return new Function(`${body} }`)()
}

describe('resolveImage (build side of lysark-v2.md step 2)', () => {
  it('finds an image relative to slides.md', () => {
    expect(resolveIn('images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
    expect(resolveIn('./images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
  })

  it('reaches the course assets folder with ../', () => {
    expect(resolveIn('../../assets/logo.svg')).toBe(join(course, 'assets', 'logo.svg'))
  })

  it('accepts a percent-encoded name, as markdown writes spaces and ø', () => {
    expect(resolveIn('images/r%C3%B8d%20robot.jpg')).toBe(join(lecture, 'images', 'rød robot.jpg'))
  })

  it('refuses a web address, naming the lecture and slide', () => {
    expect(() => resolveIn('https://example.com/a.png')).toThrow(/l1\/slides\.md, slide 's3'.*web address/)
    expect(() => resolveIn('//cdn.example.com/a.png')).toThrow(/web address/)
  })

  it('refuses a path starting with /, a backslash, or a drive letter', () => {
    expect(() => resolveIn('/images/arm.png')).toThrow(/relative to slides\.md/)
    expect(() => resolveIn('images\\arm.png')).toThrow(/backslash/)
    expect(() => resolveIn('images%5Carm.png')).toThrow(/backslash/)
    expect(() => resolveIn('C:/pics/x.png')).toThrow(/absolute path/)
  })

  it('refuses an image outside the lecture folder and assets/', () => {
    expect(() => resolveIn('../other/images/x.png')).toThrow(/outside the lecture folder/)
    expect(() => resolveIn('../../../elsewhere/p.png')).toThrow(/outside the lecture folder/)
  })

  it('refuses wrong capital letters, naming the file on disk', () => {
    expect(() => resolveIn('images/img_1234.jpg')).toThrow(/wrong capital letters.*IMG_1234\.JPG/)
    expect(() => resolveIn('Images/arm.png')).toThrow(/wrong capital letters.*'images'/)
  })

  it('checks letter case all along the path as written, as the Linux build does', () => {
    // folders the path names on its way back down, which Windows would find in any case
    expect(() => resolveIn('../../Assets/logo.svg')).toThrow(/wrong capital letters: on disk the name is 'assets'/)
    expect(() => resolveIn('../L1/images/arm.png')).toThrow(/wrong capital letters: on disk the name is 'l1'/)
    // 'name/..' is read from the text, as path.resolve and Linux read it, so the name needn't exist
    expect(resolveIn('nonexistent/../images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
    expect(resolveIn('../l1/images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
  })

  it('gives the paths written and the paths on disk when only letter case is wrong', () => {
    let looked: string[] = []
    expect(() => resolveImage(ref('Images/arm.png'), slidesPath, course, (p) => (looked = p))).toThrow(/wrong capital letters/)
    expect(looked).toEqual([join(lecture, 'Images', 'arm.png'), join(lecture, 'images', 'arm.png')])
  })

  it('refuses a missing file, naming the slide, and reports where it looked', () => {
    let looked: string[] = []
    expect(() => resolveImage(ref('images/missing.png'), slidesPath, course, (p) => (looked = p))).toThrow(
      /slide 's3'.*not found/,
    )
    expect(looked).toEqual([join(lecture, 'images', 'missing.png')])
  })

  it('refuses a file that is not an image', () => {
    expect(() => resolveIn('notes.txt')).toThrow(/not a supported image type/)
  })
})

describe('a course whose assets folder is named in other letter case', () => {
  // the published site hashes the folder named `assets` (scripts/site.mjs), and Linux finds no other
  let other: string
  let demo: string
  beforeAll(() => {
    other = mkdtempSync(join(tmpdir(), 'lysark-assets-'))
    demo = join(other, 'lectures', 'demo')
    mkdirSync(demo, { recursive: true })
    mkdirSync(join(other, 'Assets'))
    writeFileSync(join(demo, 'slides.md'), '')
    writeFileSync(join(other, 'Assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(other, 'Assets', 'x.stl'), 'solid x\nendsolid x\n')
  })
  afterAll(() => rmSync(other, { recursive: true, force: true }))

  it('refuses an image in it, however the path writes the folder', () => {
    const message =
      "demo/slides.md, slide 's3': the image '../../Assets/logo.svg' is in the course's assets folder, which on disk " +
      "is named 'Assets'. It must be named 'assets', because the course is built on Linux. Rename the folder with " +
      'git mv (renaming only the case in Explorer is invisible to git).'
    expect(() => resolveImage(ref('../../Assets/logo.svg'), join(demo, 'slides.md'), other)).toThrow(message)
    expect(() => resolveImage(ref('../../assets/logo.svg'), join(demo, 'slides.md'), other)).toThrow(/which on disk is named 'Assets'/)
  })

  it('refuses a model in it, and watches the folder as on disk too', () => {
    let looked: string[] = []
    expect(() => resolveFile('model', '../../assets/x.stl', 'here', demo, other, (p) => (looked = p))).toThrow(
      "here: the model '../../assets/x.stl' is in the course's assets folder, which on disk is named 'Assets'. " +
        "It must be named 'assets', because the course is built on Linux. Rename the folder with git mv " +
        '(renaming only the case in Explorer is invisible to git)',
    )
    expect(looked).toEqual([join(other, 'assets', 'x.stl'), join(other, 'Assets', 'x.stl')])
    expect(() => resolveFile('model', '../../Assets/x.stl', 'here', demo, other)).toThrow(/which on disk is named 'Assets'/)
  })
})

describe('slidesPlugin transform', () => {
  it('stores each image file once, however many slides and spellings use it', async () => {
    const md = [
      '---\nid: a\n---\n![x](images/arm.png)',
      '---\nid: b\n---\n![x](images/arm.png)',
      '---\nid: c\n---\n<img src="./images/arm.png" width="100">',
    ].join('\n')
    const code = await transform(md, slidesPath)
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    expect(code.split(base64).length - 1).toBe(1)
    expect(code).not.toContain('lysark-image:')
    // the module is valid JavaScript whose slides hold the full data URI three times
    const { slides, models } = run(code) as { slides: Array<{ fragments: string[] }>; models: object }
    expect(slides.map((s) => s.fragments[0].includes(`data:image/png;base64,${base64}`))).toEqual([true, true, true])
    // a lecture without models still exports them, so the deck module can always import them
    expect(models).toEqual({})
    expect(existsSync(slidesPath)).toBe(true)
  })
})

describe('scene files in the build (docs/scene-files.md)', () => {
  it('reads the lecture scene files and resolves named views, watching each file', async () => {
    mkdirSync(join(lecture, 'scenes'), { recursive: true })
    const scene = join(lecture, 'scenes', 'arm.yaml')
    writeFileSync(scene, 'base: arm\nviews:\n  nært:\n    lookAt: [0, 0.5, 0]\n    offset: [1, 2, 3]\n')
    writeFileSync(join(lecture, 'scenes', 'notes.txt'), 'not a scene file')
    try {
      expect(Object.keys(lectureSceneFiles(lecture))).toEqual(['scenes/arm.yaml'])
      const watched: string[] = []
      const code = await transform('---\nscene: arm\ncamera: nært\n---\n# x\n', slidesPath, watched)
      const slides = run(code).slides as Array<{ effective: { camera: unknown } }>
      expect(slides[0].effective.camera).toEqual({ lookAt: [0, 0.5, 0], offset: [1, 2, 3] })
      expect(watched).toContain(scene)
    } finally {
      rmSync(join(lecture, 'scenes'), { recursive: true, force: true })
    }
    expect(lectureSceneFiles(lecture)).toEqual({})
  })
})

describe('models in the build (docs/scene-files.md, "Models")', () => {
  // a lecture of its own, so its scene file is no other test's
  let m1: string
  let slides: string
  const SLIDE = '---\nscene: arm\n---\n# x\n'
  // 20 mm across, standing on z, as CAD writes it; under 4 kB, as is the GLB, so
  // Node reads each into its shared Buffer pool
  const part = binaryStl(cylinder({ radius: 10, height: 20, axis: 'z' }))
  const tray = glb({ meshes: [{ name: 'tray' }, { name: 'lid', translation: [0, 1, 0] }] })
  const base64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64')
  const file = (path: string, bytes: ArrayBuffer) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, new Uint8Array(bytes))
  }
  /** the lecture's scene file with these objects, indented under objects: from line 3 */
  const objects = (yaml: string) => writeFileSync(join(m1, 'scenes', 'arm.yaml'), `base: arm\nobjects:\n${yaml}`)
  /** the build's message for a lecture whose scene file has these objects */
  const failure = (yaml: string) => {
    objects(yaml)
    return transform(SLIDE, slides).then(
      () => 'built',
      (error: Error) => error.message,
    )
  }

  beforeAll(() => {
    m1 = join(course, 'lectures', 'm1')
    slides = join(m1, 'slides.md')
    mkdirSync(join(m1, 'scenes'), { recursive: true })
    writeFileSync(slides, '')
    file(join(m1, 'models', 'part.stl'), part)
    file(join(m1, 'scenes', 'parts', 'kept.stl'), part)
    file(join(course, 'assets', 'tray.glb'), tray)
  })

  it('stores each model file once, by every path written for it, and watches it', async () => {
    objects(
      '  a:\n    model: models/part.stl\n    unit: mm\n    up: z\n' +
        '  b:\n    model: ./models/part.stl\n    unit: mm\n' +
        '  c:\n    model: ../../assets/tray.glb\n',
    )
    const watched: string[] = []
    const code = await transform(SLIDE, slides, watched)
    expect(code.split(base64(part)).length - 1).toBe(1)
    expect(code.split(base64(tray)).length - 1).toBe(1)
    // exactly the files' bytes, though Node read each into a larger pooled buffer
    expect(run(code).models).toEqual({
      'models/part.stl': base64(part),
      './models/part.stl': base64(part),
      '../../assets/tray.glb': base64(tray),
    })
    expect(watched).toEqual(expect.arrayContaining([join(m1, 'models', 'part.stl'), join(course, 'assets', 'tray.glb')]))
  })

  it('never looks for the model of a scene no slide runs', async () => {
    objects('  a:\n    model: models/missing.stl\n')
    expect(run(await transform('---\nid: plain\n---\n# x\n', slides)).models).toEqual({})
  })

  it('checks a shared file in each unit, naming the object whose unit is wrong', async () => {
    expect(await failure('  a:\n    model: models/part.stl\n    unit: mm\n  b:\n    model: models/part.stl\n')).toBe(
      "scenes/arm.yaml, line 7: object 'b': the model is 20 m across, read in m. Is the file in millimetres? Write unit: mm",
    )
  })

  it('refuses a file over 5 MB from its size on disk', async () => {
    const big = join(m1, 'models', 'big.stl')
    writeFileSync(big, Buffer.alloc(5_000_001))
    try {
      expect(await failure('  big:\n    model: models/big.stl\n')).toBe(
        "scenes/arm.yaml, line 4: object 'big': the model is 5.000001 MB; a model may be at most 5 MB. " +
          'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
      )
    } finally {
      rmSync(big)
    }
  })

  it('refuses what checkModel refuses: an LFS pointer, a textured GLB', async () => {
    file(join(m1, 'models', 'lfs.stl'), lfsPointer())
    file(join(m1, 'models', 'painted.glb'), glb({ edits: [glbEdits.image()] }))
    expect(await failure('  pointer:\n    model: models/lfs.stl\n')).toMatch(
      /^scenes\/arm\.yaml, line 4: object 'pointer': the model is a Git LFS pointer, not the model/,
    )
    expect(await failure('  table:\n    box: [0.4, 0.3, 0.4]\n  painted:\n    model: models/painted.glb\n')).toMatch(
      /^scenes\/arm\.yaml, line 6: object 'painted': the model has textures, which come in a later step/,
    )
  })

  it('refuses wrong capital letters, naming the file on disk', async () => {
    expect(await failure('  a:\n    model: models/Part.stl\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a': the model 'models/Part.stl' has the wrong capital letters: on disk the name is " +
        "'part.stl'. Letter case must match, because the course is built on Linux. Fix the path in the scene file, " +
        "or rename 'part.stl' with git mv (renaming only the case in Explorer is invisible to git)",
    )
  })

  it('checks letter case all along the path as written, as the Linux build does', async () => {
    expect(await failure('  a:\n    model: ../../Assets/tray.glb\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a': the model '../../Assets/tray.glb' has the wrong capital letters: on disk the name is " +
        "'assets'. Letter case must match, because the course is built on Linux. Fix the path in the scene file, " +
        "or rename 'assets' with git mv (renaming only the case in Explorer is invisible to git)",
    )
    expect(await failure('  a:\n    model: ../M1/models/part.stl\n    unit: mm\n')).toMatch(
      /the model '\.\.\/M1\/models\/part\.stl' has the wrong capital letters: on disk the name is 'm1'\./,
    )
    // 'name/..' is read from the text, as Linux reads it, so the name needn't exist
    expect(await failure('  a:\n    model: nonexistent/../models/part.stl\n    unit: mm\n')).toBe('built')
    expect(await failure('  a:\n    model: ./models/part.stl\n    unit: mm\n')).toBe('built')
    expect(await failure('  a:\n    model: ../m1/models/part.stl\n    unit: mm\n')).toBe('built')
  })

  it("refuses a model through a link in the lecture folder or assets/, which VS Code's panel won't read", async ({ skip }) => {
    const cad = join(course, 'cad')
    file(join(cad, 'part.stl'), part)
    writeFileSync(join(cad, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    try {
      // a junction, which Windows lets anyone make; Node reads it as a link
      symlinkSync(cad, join(m1, 'linked'), 'junction')
      symlinkSync(cad, join(course, 'assets', 'linked'), 'junction')
    } catch (error) {
      skip(`this process can't make a link: ${(error as Error).message}`)
    }
    expect(await failure('  a:\n    model: linked/part.stl\n    unit: mm\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a': the model 'linked/part.stl' goes through a link ('linked'), which VS Code's panel " +
        "won't read: copy the file into place",
    )
    expect(await failure('  a:\n    model: ../../assets/linked/part.stl\n    unit: mm\n')).toMatch(
      /goes through a link \('\.\.\/\.\.\/assets\/linked'\)/,
    )
    // an image may still go through one, as before
    expect(resolveImage(ref('linked/pic.png'), slides, course)).toBe(join(m1, 'linked', 'pic.png'))
    // the lecture folder itself the panel never checks: reached through a link, its models are read
    const j1 = join(course, 'lectures', 'j1')
    symlinkSync(m1, j1, 'junction')
    expect(resolveFile('model', 'models/part.stl', 'here', j1, course)).toBe(join(j1, 'models', 'part.stl'))
    expect(resolveFile('model', '../j1/models/part.stl', 'here', j1, course)).toBe(join(j1, 'models', 'part.stl'))
  })

  it('reloads the preview when a file in the wrong letter case is renamed, as the message says', async () => {
    const r1 = join(course, 'lectures', 'r1')
    const id = join(r1, 'slides.md')
    file(join(r1, 'models', 'bracket.stl'), part)
    mkdirSync(join(r1, 'scenes'), { recursive: true })
    writeFileSync(join(r1, 'scenes', 'arm.yaml'), 'base: arm\nobjects:\n  a:\n    model: models/Bracket.stl\n    unit: mm\n')
    writeFileSync(id, SLIDE)
    // lysark dev, with a watcher and a page to reload
    const plugin = slidesPlugin({ courseRoot: course })
    const watcher = Object.assign(new EventEmitter(), { add: () => undefined })
    const sent: unknown[] = []
    const server = {
      watcher,
      ws: { send: (message: unknown) => sent.push(message) },
      moduleGraph: { getModuleById: () => undefined, invalidateModule: () => undefined },
    }
    ;(plugin.configureServer as (server: unknown) => void)(server)
    const build = () => (plugin.transform as Transform).call({ addWatchFile: () => undefined }, SLIDE, id)
    await expect(build()).rejects.toThrow(/has the wrong capital letters: on disk the name is 'bracket\.stl'/)
    renameSync(join(r1, 'models', 'bracket.stl'), join(r1, 'models', 'Bracket.stl'))
    // each event the rename can give reloads the page on its own
    watcher.emit('unlink', join(r1, 'models', 'bracket.stl'))
    expect(sent).toEqual([{ type: 'full-reload' }])
    watcher.emit('add', join(r1, 'models', 'Bracket.stl'))
    expect(sent).toHaveLength(2)
    expect((plugin.handleHotUpdate as (context: { file: string }) => unknown)({ file: join(r1, 'models', 'Bracket.stl') })).toEqual([])
    expect(sent).toHaveLength(3)
    // and the page it reloads builds
    expect(run((await build()).code).models).toEqual({ 'models/Bracket.stl': base64(part) })
  })

  it('says where it looked for a missing model', async () => {
    expect(await failure('  a:\n    model: models/missing.stl\n')).toBe(
      `scenes/arm.yaml, line 4: object 'a': the model 'models/missing.stl' was not found ` +
        `(looked for ${join(m1, 'models', 'missing.stl')}). Paths in scene files are from the lecture folder, ` +
        `where slides.md is, as for images`,
    )
  })

  it('refuses a model outside the lecture folder and assets/', async () => {
    expect(await failure('  a:\n    model: ../l1/notes.stl\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a': the model '../l1/notes.stl' is outside the lecture folder. Put it in the " +
        "lecture folder (for example models/), or in the course's assets/ folder if several lectures use it",
    )
  })

  it('says how to write a path written from scenes/, when that names a file', async () => {
    // from scenes/, both name a file; from the lecture folder, both are outside it
    expect(await failure('  a:\n    model: ../../../assets/tray.glb\n')).toBe(
      "scenes/arm.yaml, line 4: object 'a': the model '../../../assets/tray.glb' is outside the lecture folder. " +
        'Write ../../assets/tray.glb: the path is from the lecture folder, not from scenes/',
    )
    expect(await failure('  a:\n    model: ../models/part.stl\n')).toMatch(/Write models\/part\.stl: the path is from the lecture folder/)
    // inside the lecture folder from both, and found only from scenes/
    expect(await failure('  a:\n    model: parts/kept.stl\n')).toMatch(
      /was not found .*as for images\. Write scenes\/parts\/kept\.stl: the path is from the lecture folder, not from scenes\/$/,
    )
  })
})
