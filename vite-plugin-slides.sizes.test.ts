import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { binaryStl, cylinder } from './src/scene/model-test-files.js'
import { slidesPlugin } from './vite-plugin-slides'

/**
 * The build's checks of a model file's size on disk, with files that are
 * small but whose size the plugin is told is larger (statSync), so a test
 * needs no file of hundreds of MB; and which files it read (readFileSync).
 */
const disk = vi.hoisted(() => ({ sizes: new Map<string, number>(), reads: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const { resolve: absolute } = await import('node:path')
  const statSync = ((path: string, options?: object) => {
    const stats = fs.statSync(path, options)
    const size = disk.sizes.get(absolute(String(path)))
    return size === undefined || !stats ? stats : Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { size })
  }) as typeof fs.statSync
  const readFileSync = ((path: string, options?: object) => {
    disk.reads.push(absolute(String(path)))
    return fs.readFileSync(path, options as never)
  }) as typeof fs.readFileSync
  return { ...fs, default: { ...fs, statSync, readFileSync }, statSync, readFileSync }
})

let course: string
let lecture: string
const part = binaryStl(cylinder({ radius: 10, height: 20, axis: 'z' }))

beforeAll(() => {
  course = mkdtempSync(join(tmpdir(), 'lysark-sizes-'))
  lecture = join(course, 'lectures', 'l1')
  mkdirSync(join(lecture, 'scenes'), { recursive: true })
  mkdirSync(join(lecture, 'models'), { recursive: true })
  writeFileSync(join(lecture, 'slides.md'), '')
  for (const name of ['big.stl', 'huge.stl', 'half.stl', 'other.stl']) writeFileSync(join(lecture, 'models', name), new Uint8Array(part))
})
afterAll(() => rmSync(course, { recursive: true, force: true }))
beforeEach(() => {
  disk.sizes.clear()
  disk.reads.length = 0
  rmSync(join(lecture, 'scenes'), { recursive: true, force: true })
  mkdirSync(join(lecture, 'scenes'))
})

const model = (name: string) => resolve(lecture, 'models', name)
/** the build's message for the lecture with these scene files, or 'built' */
async function build(scenes: Record<string, string>, slides = '---\nscene: arm\n---\n# x\n'): Promise<string> {
  for (const [name, text] of Object.entries(scenes)) writeFileSync(join(lecture, 'scenes', name), text)
  const plugin = slidesPlugin({ courseRoot: course })
  type Transform = (this: unknown, code: string, id: string) => Promise<{ code: string }>
  return (plugin.transform as Transform).call({ addWatchFile: () => {} }, slides, join(lecture, 'slides.md')).then(
    () => 'built',
    (error: Error) => error.message,
  )
}

describe("models' size on disk in the build", () => {
  it('refuses a file over 5 MB at the first object whose scene file keeps the limits, without reading it', async () => {
    disk.sizes.set(model('big.stl'), 6_000_000)
    const both = '---\nscene: agilus\n---\n# y\n---\nscene: arm\n---\n# x\n'
    // agilus.yaml, read first, lifts the limits; arm.yaml keeps them
    const message = await build(
      {
        'agilus.yaml': 'base: agilus\nlimits: off\nobjects:\n  big:\n    model: models/big.stl\n    unit: mm\n',
        'arm.yaml': 'base: arm\nobjects:\n  big:\n    model: models/big.stl\n    unit: mm\n',
      },
      both,
    )
    expect(message).toMatch(/^scenes\/arm\.yaml, line 4: object 'big': the model is 6\.0 MB; a model may be at most 5 MB\. /)
    expect(disk.reads).not.toContain(model('big.stl'))
  })

  it('refuses, with limits: off, more models than a student file can hold, at its line, without reading the file', async () => {
    // base64 of more bytes than this is longer than Node makes a string
    disk.sizes.set(model('huge.stl'), 402_653_167)
    expect(await build({ 'arm.yaml': 'limits: off\nbase: arm\nobjects:\n  huge:\n    model: models/huge.stl\n    unit: mm\n' })).toBe(
      "scenes/arm.yaml, line 5: object 'huge': the model is 402.7 MB: a student file can hold at most about 400 MB of models in all, " +
        'even with limits: off (its script is one JavaScript string, which can be no longer). Export it smaller',
    )
    expect(disk.reads).not.toContain(model('huge.stl'))
    // one at the most it can hold is read and built in
    disk.sizes.set(model('huge.stl'), 402_653_166)
    disk.reads.length = 0
    expect(await build({ 'arm.yaml': 'limits: off\nbase: arm\nobjects:\n  huge:\n    model: models/huge.stl\n    unit: mm\n' })).toBe('built')
    expect(disk.reads).toContain(model('huge.stl'))
  })

  it('refuses the file that takes them all over it, at its first object', async () => {
    disk.sizes.set(model('half.stl'), 250_000_000)
    disk.sizes.set(model('other.stl'), 200_000_000)
    const objects =
      '  half:\n    model: models/half.stl\n    unit: mm\n' +
      '  again:\n    model: ./models/half.stl\n    unit: mm\n' +
      '  other:\n    model: models/other.stl\n    unit: mm\n' +
      '  more:\n    model: models/other.stl\n    unit: mm\n'
    expect(await build({ 'arm.yaml': `limits: off\nbase: arm\nobjects:\n${objects}` })).toBe(
      "scenes/arm.yaml, line 11: object 'other': with this model, the lecture's models are 450.0 MB: a student file can hold at most " +
        'about 400 MB of models in all, even with limits: off (its script is one JavaScript string, which can be no longer). ' +
        'Show fewer models, or smaller ones',
    )
    expect(disk.reads).not.toContain(model('other.stl'))
  })
})
