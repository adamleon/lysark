import { describe, expect, it } from 'vitest'
import { modelFormat, type ModelRef } from '../compiler/model-types'
import type { ModelUnit } from '../engine/object-types'
import { binaryStl, box, glb, glbEdits, lfsPointer } from '../scene/model-test-files.js'
import type { HostFile } from './host'
import { base64Bytes, loadModels } from './panel-models'

/** a model as the compiler reports it, in scenes/arm.yaml */
const ref = (object: string, src: string, line: number, unit: ModelUnit = 'm'): ModelRef => ({
  src,
  format: modelFormat(src)!,
  unit,
  object,
  file: 'scenes/arm.yaml',
  line,
})

/** a file's bytes as the host sends them */
function base64(buffer: ArrayBuffer): string {
  let text = ''
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte)
  return btoa(text)
}

/** a stand-in for host.read: these files, 'not found' for any other path; it notes what it was asked */
function host(files: Record<string, HostFile>) {
  const asked: string[][] = []
  const read = async (paths: string[]) => {
    asked.push(paths)
    return Object.fromEntries(paths.map((path) => [path, files[path] ?? { error: 'not found' }]))
  }
  return { asked, read }
}

const OUTSIDE = "outside the lecture folder and the course's assets/ folder"

describe('loadModels', () => {
  it('reads each file once, and gives a good one by every src that names it', async () => {
    const bracket = base64(binaryStl(box([0, 0, 0], [60, 25, 40])))
    const tray = base64(glb({ meshes: [{}, { translation: [0.5, 0, 0] }] }))
    const { asked, read } = host({ 'models/bracket.stl': { base64: bracket }, '../../assets/tray.glb': { base64: tray } })
    const loaded = await loadModels(
      [
        ref('bracket', 'models/bracket.stl', 12, 'mm'),
        ref('tray', '../../assets/tray.glb', 18),
        ref('spare', './models/bracket.stl', 24, 'mm'),
      ],
      read,
    )
    expect(asked).toEqual([['models/bracket.stl', '../../assets/tray.glb']])
    expect(loaded).toEqual({
      files: { 'models/bracket.stl': bracket, './models/bracket.stl': bracket, '../../assets/tray.glb': tray },
      problems: [],
    })
  })

  it('names a missing file at its line, with the way to write a path written from scenes/', async () => {
    const part = { base64: base64(binaryStl()) }
    const { asked, read } = host({
      '../../../assets/tray.glb': { error: OUTSIDE },
      '../models/bracket.stl': { error: OUTSIDE },
      // where the paths lead from scenes/
      '../../assets/tray.glb': part,
      'models/bracket.stl': part,
      'scenes/inside.stl': part,
    })
    const loaded = await loadModels(
      [
        ref('gone', 'models/gone.stl', 12),
        ref('tray', '../../../assets/tray.glb', 14),
        ref('bracket', '../models/bracket.stl', 16),
        ref('inside', 'inside.stl', 18),
      ],
      read,
    )
    // asked for again from scenes/ only once the first answers say the files aren't there
    expect(asked).toEqual([
      ['models/gone.stl', '../../../assets/tray.glb', '../models/bracket.stl', 'inside.stl'],
      ['scenes/models/gone.stl', '../../assets/tray.glb', 'models/bracket.stl', 'scenes/inside.stl'],
    ])
    const fromScenes = ': the path is from the lecture folder, not from scenes/'
    const notFound = 'was not found. Paths in scene files are from the lecture folder, where slides.md is, as for images'
    expect(loaded).toEqual({
      files: {},
      problems: [
        `scenes/arm.yaml, line 12: object 'gone': the model 'models/gone.stl' ${notFound}`,
        `scenes/arm.yaml, line 14: object 'tray': the model '../../../assets/tray.glb': ${OUTSIDE}. Write ../../assets/tray.glb${fromScenes}`,
        `scenes/arm.yaml, line 16: object 'bracket': the model '../models/bracket.stl': ${OUTSIDE}. Write models/bracket.stl${fromScenes}`,
        `scenes/arm.yaml, line 18: object 'inside': the model 'inside.stl' ${notFound}. Write scenes/inside.stl${fromScenes}`,
      ],
    })
  })

  it("gives the host's own reason, and asks again only for a file that isn't there", async () => {
    const { asked, read } = host({
      'models/late.stl': { error: 'VS Code did not answer' },
      'models/big.stl': { error: 'larger than 32 MB' },
      'models/folder.stl': { error: 'a folder, not a file' },
    })
    const loaded = await loadModels([ref('late', 'models/late.stl', 3), ref('big', 'models/big.stl', 5), ref('folder', 'models/folder.stl', 7)], read)
    expect(asked).toHaveLength(1)
    expect(loaded.problems).toEqual([
      "scenes/arm.yaml, line 3: object 'late': the model 'models/late.stl': VS Code did not answer",
      // VS Code's own limit gets lysark's advice
      "scenes/arm.yaml, line 5: object 'big': the model is larger than 32 MB; a model may be at most 5 MB. " +
        'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
      "scenes/arm.yaml, line 7: object 'folder': the model 'models/folder.stl': a folder, not a file",
    ])
  })

  it('measures a file from its base64, and refuses one over the limit without decoding it', async () => {
    expect([base64Bytes(''), base64Bytes('AA=='), base64Bytes('AAA='), base64Bytes('AAAA')]).toEqual([0, 1, 2, 3])
    expect(base64Bytes(base64(binaryStl()))).toBe(binaryStl().byteLength)
    // 5,000,001 bytes, of characters that aren't base64: decoding them would fail otherwise
    const over = { base64: '*'.repeat(6_666_668) }
    const { read } = host({ 'models/huge.stl': over, 'models/odd.stl': { base64: '*AAA' } })
    const loaded = await loadModels([ref('huge', 'models/huge.stl', 9), ref('odd', 'models/odd.stl', 11)], read)
    expect(loaded.files).toEqual({})
    expect(loaded.problems).toEqual([
      "scenes/arm.yaml, line 9: object 'huge': the model is 5.000001 MB; a model may be at most 5 MB. " +
        'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
      // not base64 at all (the host never sends that): left out, and the panel starts
      expect.stringMatching(/^scenes\/arm\.yaml, line 11: object 'odd': the model couldn't be read: \S/),
    ])
  })

  it('refuses what the build refuses, at the line of the object it is about', async () => {
    const good = base64(binaryStl(box([0, 0, 0], [412, 30, 10])))
    const { read } = host({
      'models/pointer.stl': { base64: base64(lfsPointer()) },
      'models/textured.glb': { base64: base64(glb({ edits: [glbEdits.image()] })) },
      'models/part.stl': { base64: good },
      'models/other.stl': { base64: good },
    })
    const loaded = await loadModels(
      [
        ref('pointer', 'models/pointer.stl', 20),
        ref('textured', 'models/textured.glb', 26),
        // one file in two units: the object read in the wrong one is named
        ref('right', 'models/part.stl', 32, 'mm'),
        ref('wrong', 'models/part.stl', 38),
        ref('fine', 'models/other.stl', 44, 'mm'),
      ],
      read,
    )
    expect(loaded.files).toEqual({ 'models/other.stl': good })
    expect(loaded.problems).toEqual([
      expect.stringMatching(/^scenes\/arm\.yaml, line 20: object 'pointer': the model is a Git LFS pointer, not the model: /),
      expect.stringMatching(/^scenes\/arm\.yaml, line 26: object 'textured': the model has textures, /),
      "scenes/arm.yaml, line 38: object 'wrong': the model is 412 m across, read in m. Is the file in millimetres? Write unit: mm",
    ])
  })

  it('asks for nothing when no scene a slide runs has a model', async () => {
    const { asked, read } = host({})
    expect(await loadModels([], read)).toEqual({ files: {}, problems: [] })
    expect(asked).toEqual([])
  })
})
