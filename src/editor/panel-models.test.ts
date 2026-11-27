import { describe, expect, it } from 'vitest'
import { modelFormat, modelWhere, type ModelLimits, type ModelLook, type ModelRef } from '../compiler/model-types'
import { readSceneFiles } from '../compiler/scene-files'
import type { ModelUnit } from '../engine/object-types'
import { checkModel } from '../scene/model-check'
import { binaryStl, box, glb, glbEdits, jpeg, lfsPointer, overLimitStl, png } from '../scene/model-test-files.js'
import type { HostFile } from './host'
import { base64Bytes, limitsChanged, loadModels } from './panel-models'

/** a model as the compiler reports it, in scenes/arm.yaml unless `file` says another scene file */
const ref = (
  object: string,
  src: string,
  line: number,
  unit: ModelUnit = 'm',
  look: ModelLook = 'default',
  limits: ModelLimits = 'on',
  file = 'scenes/arm.yaml',
): ModelRef => ({
  src,
  format: modelFormat(src)!,
  unit,
  look,
  limits,
  object,
  file,
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
      leftOut: [],
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
      leftOut: [],
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
      'models/big.glb': { error: 'larger than 32 MB' },
      'models/folder.stl': { error: 'a folder, not a file' },
    })
    const loaded = await loadModels(
      [ref('late', 'models/late.stl', 3), ref('big', 'models/big.stl', 5), ref('bigger', 'models/big.glb', 6), ref('folder', 'models/folder.stl', 7)],
      read,
    )
    expect(asked).toHaveLength(1)
    const tooLarge = "is larger than 32 MB: VS Code's editor reads at most 32 MB per file, so the preview can't show it. The lecture doesn't build with it either"
    expect(loaded.problems).toEqual([
      "scenes/arm.yaml, line 3: object 'late': the model 'models/late.stl': VS Code did not answer",
      // VS Code's own limit, said first, then lysark's advice, for the file's format
      `scenes/arm.yaml, line 5: object 'big': the model 'models/big.stl' ${tooLarge}: a model may be at most 5 MB. ` +
        'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
      `scenes/arm.yaml, line 6: object 'bigger': the model 'models/big.glb' ${tooLarge}: a model may be at most 5 MB, its textures included. ` +
        "Export it with fewer triangles, or its textures as JPEG rather than PNG (in Blender's glTF export, under Data > Material, Images: JPEG Format) or smaller",
      "scenes/arm.yaml, line 7: object 'folder': the model 'models/folder.stl': a folder, not a file",
    ])
  })

  it("says a file over what VS Code reads isn't held to the size limits with limits: off, once, where the build would stop (decision 11)", async () => {
    const { read } = host({ 'models/part.glb': { error: 'larger than 32 MB' } })
    const preview = "the model 'models/part.glb' is larger than 32 MB: VS Code's editor reads at most 32 MB per file, so the preview can't show it"
    const off = await loadModels([ref('part', 'models/part.glb', 9, 'm', 'file', 'off'), ref('again', 'models/part.glb', 14, 'm', 'file', 'off')], read)
    // only what the panel knows: it never saw the bytes, so it can't say the rest of the file passes
    expect(off).toEqual({
      files: {},
      leftOut: [],
      problems: [`scenes/arm.yaml, line 9: object 'part': ${preview}. Its size doesn't stop the build, because its scene file says limits: off`],
    })
    // read from a scene file without limits: off too: named once, at the first object in a
    // file that keeps the limits, where the build stops, and never said to build
    const both = await loadModels(
      [
        ref('part', 'models/part.glb', 9, 'm', 'file', 'off'),
        ref('again', 'models/part.glb', 14, 'm', 'file', 'off'),
        ref('kept', 'models/part.glb', 4, 'm', 'file', 'on', 'scenes/agilus.yaml'),
        ref('also', 'models/part.glb', 6, 'm', 'file', 'on', 'scenes/agilus.yaml'),
      ],
      read,
    )
    expect(both.problems).toEqual([
      `scenes/agilus.yaml, line 4: object 'kept': ${preview}. The lecture doesn't build with it either: a model may be at most 5 MB, its textures included. ` +
        "Export it with fewer triangles, or its textures as JPEG rather than PNG (in Blender's glTF export, under Data > Material, Images: JPEG Format) or smaller",
    ])
    // another of the host's reasons is the same for both: said once
    const { read: gone } = host({})
    expect((await loadModels([ref('part', 'models/part.glb', 9, 'm', 'file', 'off'), ref('kept', 'models/part.glb', 4, 'm', 'file', 'on', 'scenes/agilus.yaml')], gone)).problems).toEqual([
      expect.stringMatching(/^scenes\/arm\.yaml, line 9: object 'part': the model 'models\/part\.glb' was not found/),
    ])
  })

  it("says the size of a file over what VS Code reads when the host gives it (extension 0.4.1), in the build's MB format", async () => {
    const { read } = host({
      'models/part.glb': { error: 'larger than 32 MB', bytes: 41_234_567 },
      'models/edge.stl': { error: 'larger than 32 MB', bytes: 32_000_001 },
    })
    const sized = (src: string, mb: string) =>
      `the model '${src}' is ${mb} MB, more than the 32 MB VS Code's editor reads per file, so the preview can't show it`
    const off = await loadModels([ref('part', 'models/part.glb', 9, 'm', 'file', 'off'), ref('edge', 'models/edge.stl', 12, 'm', 'default', 'off')], read)
    expect(off.problems).toEqual([
      `scenes/arm.yaml, line 9: object 'part': ${sized('models/part.glb', '41.2')}. Its size doesn't stop the build, because its scene file says limits: off`,
      // one byte over: as many decimals as it takes to show it is over, as the build's "the model is 5.000001 MB"
      `scenes/arm.yaml, line 12: object 'edge': ${sized('models/edge.stl', '32.000001')}. Its size doesn't stop the build, because its scene file says limits: off`,
    ])
    const on = await loadModels([ref('part', 'models/part.glb', 9, 'm', 'file'), ref('edge', 'models/edge.stl', 12)], read)
    expect(on.problems).toEqual([
      `scenes/arm.yaml, line 9: object 'part': ${sized('models/part.glb', '41.2')}. The lecture doesn't build with it either: a model may be at most 5 MB, its textures included. ` +
        "Export it with fewer triangles, or its textures as JPEG rather than PNG (in Blender's glTF export, under Data > Material, Images: JPEG Format) or smaller",
      `scenes/arm.yaml, line 12: object 'edge': ${sized('models/edge.stl', '32.000001')}. The lecture doesn't build with it either: a model may be at most 5 MB. ` +
        'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
    ])
  })

  it("says what v2.14.0 says without the size (extension 0.4.0), or with one that isn't a size over the limit", async () => {
    const words = "the model 'models/part.stl' is larger than 32 MB: VS Code's editor reads at most 32 MB per file, so the preview can't show it"
    // left out, not a number, negative, not finite, not over the 32 MB the error names
    for (const bytes of [undefined, '41234567', null, -41_234_567, Number.NaN, Number.POSITIVE_INFINITY, 32_000_000, 1000]) {
      const { read } = host({ 'models/part.stl': { error: 'larger than 32 MB', ...(bytes === undefined ? {} : { bytes: bytes as number }) } })
      const off = await loadModels([ref('part', 'models/part.stl', 9, 'm', 'default', 'off')], read)
      expect(off.problems, String(bytes)).toEqual([`scenes/arm.yaml, line 9: object 'part': ${words}. Its size doesn't stop the build, because its scene file says limits: off`])
      const on = await loadModels([ref('part', 'models/part.stl', 9)], read)
      expect(on.problems, String(bytes)).toEqual([
        `scenes/arm.yaml, line 9: object 'part': ${words}. The lecture doesn't build with it either: a model may be at most 5 MB. ` +
          'Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)',
      ])
    }
    // a limit not written `<n> MB`, as no extension writes it: its words as they are, without the size
    const { read } = host({ 'models/part.stl': { error: 'larger than 32 MiB', bytes: 41_234_567 } })
    expect((await loadModels([ref('part', 'models/part.stl', 9, 'm', 'default', 'off')], read)).problems).toEqual([
      "scenes/arm.yaml, line 9: object 'part': the model 'models/part.stl' is larger than 32 MiB: VS Code's editor reads at most 32 MiB per file, " +
        "so the preview can't show it. Its size doesn't stop the build, because its scene file says limits: off",
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
    // the file read in the right unit is still shown to 'right': only 'wrong' goes without it
    expect(loaded.files).toEqual({ 'models/part.stl': good, 'models/other.stl': good })
    expect(loaded.leftOut).toEqual(['scenes/arm.yaml wrong'])
    expect(loaded.problems).toEqual([
      expect.stringMatching(/^scenes\/arm\.yaml, line 20: object 'pointer': the model is a Git LFS pointer, not the model: /),
      expect.stringMatching(/^scenes\/arm\.yaml, line 26: object 'textured': the model has textures: write material: file to show them/),
      "scenes/arm.yaml, line 38: object 'wrong': the model is 412 m across, read in m. Is the file in millimetres? Write unit: mm",
    ])
  })

  it("checks a textured GLB for each object's look, as the build does (step 9)", async () => {
    const texture = (bytes: ArrayBuffer) =>
      base64(
        glb({
          meshes: [{ uvs: true, material: 0 }],
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
          textures: [{ name: 'label', bytes }],
        }),
      )
    const label = texture(png(8, 8))
    const poster = texture(png(2049, 1))
    const { read } = host({ 'models/label.glb': { base64: label }, 'models/poster.glb': { base64: poster } })
    const loaded = await loadModels(
      [
        ref('own', 'models/label.glb', 10, 'm', 'file'),
        ref('red', 'models/label.glb', 14, 'm', 'preset'),
        ref('poster', 'models/poster.glb', 18, 'm', 'file'),
        // a colour leaves the texture out, however large: the build stops at 'poster', but the
        // panel still shows the file to 'grey', and leaves it out for 'poster' only
        ref('grey', 'models/poster.glb', 22, 'm', 'preset'),
      ],
      read,
    )
    expect(loaded.files).toEqual({ 'models/label.glb': label, 'models/poster.glb': poster })
    expect(loaded.leftOut).toEqual(['scenes/arm.yaml poster'])
    expect(loaded.problems).toEqual([
      expect.stringMatching(/^scenes\/arm\.yaml, line 18: object 'poster': the model's image 'label' is 2049 x 1 pixels: a texture may be at most 2048 pixels on a side\. /),
    ])
    // no material: line: the object is named, at its line, and only it goes without the file
    const unchosen = await loadModels([ref('own', 'models/label.glb', 10, 'm', 'file'), ref('plain', 'models/label.glb', 30)], read)
    expect(unchosen.problems).toEqual([expect.stringMatching(/^scenes\/arm\.yaml, line 30: object 'plain': the model has textures: write material: file/)])
    expect(unchosen.files).toEqual({ 'models/label.glb': label })
    expect(unchosen.leftOut).toEqual(['scenes/arm.yaml plain'])
    // every way failing: the file isn't given at all, and nothing need be left out
    const none = await loadModels([ref('plain', 'models/label.glb', 30), ref('poster', 'models/poster.glb', 18, 'm', 'file')], read)
    expect(none.files).toEqual({})
    expect(none.leftOut).toEqual([])
    expect(none.problems).toHaveLength(2)
  })

  it('names a file whose textures are too many pixels in all in the words of the build (checkModel with its path)', async () => {
    const sizes = [2048, 2048, 2048, 2048, 1]
    const bytes = glb({
      meshes: sizes.map((_, k) => ({ uvs: true, material: k })),
      materials: sizes.map((_, k) => ({ pbrMetallicRoughness: { baseColorTexture: { index: k }, metallicFactor: 0 } })),
      textures: sizes.map((side) => ({ bytes: jpeg(side, side), mimeType: 'image/jpeg' })),
    })
    const { read } = host({ 'models/photos.glb': { base64: base64(bytes) } })
    const photos = ref('photos', 'models/photos.glb', 40, 'm', 'file')
    const loaded = await loadModels([photos, ref('grey', 'models/photos.glb', 46, 'm', 'preset')], read)
    // as vite-plugin-slides.ts says it: where, then checkModel's words for the object and its path
    expect(loaded.problems).toEqual([`${modelWhere(photos)}: ${await checkModel(bytes, 'glb', ['m'], 'file', 'models/photos.glb')}`])
    expect(loaded.problems[0]).toMatch(
      /^scenes\/arm\.yaml, line 40: object 'photos': the model 'models\/photos\.glb' has 16,777,217 pixels of textures in all \(5 images\); /,
    )
    expect(loaded.leftOut).toEqual(['scenes/arm.yaml photos'])
  })

  describe('limits: off (decision 11)', () => {
    const big = base64(overLimitStl())
    const poster = base64(
      glb({
        meshes: [{ uvs: true, material: 0 }],
        materials: [{ name: 'poster', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
        textures: [{ name: 'poster', bytes: jpeg(4096, 4096), mimeType: 'image/jpeg' }],
      }),
    )
    const glass = base64(glb({ meshes: [{ material: 0 }], materials: [{ name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { metallicFactor: 0 } }] }))
    const { read } = host({ 'models/big.stl': { base64: big }, 'models/poster.glb': { base64: poster }, 'models/glass.glb': { base64: glass } })

    it('shows a file over 5 MB, and textures over 2048 pixels, for the objects of a scene file with limits: off', async () => {
      const loaded = await loadModels([ref('big', 'models/big.stl', 5, 'm', 'default', 'off'), ref('poster', 'models/poster.glb', 9, 'm', 'file', 'off')], read)
      expect(loaded).toEqual({ files: { 'models/big.stl': big, 'models/poster.glb': poster }, problems: [], leftOut: [] })
      // without it, refused in the build's words, at the line
      const limited = await loadModels([ref('big', 'models/big.stl', 5), ref('poster', 'models/poster.glb', 9, 'm', 'file')], read)
      expect(limited.files).toEqual({})
      expect(limited.problems).toEqual([
        `scenes/arm.yaml, line 5: object 'big': ${await checkModel(overLimitStl(), 'stl', ['m'], 'default', 'models/big.stl')}`,
        expect.stringMatching(/^scenes\/arm\.yaml, line 9: object 'poster': the model's image 'poster' is 4096 x 4096 pixels: a texture may be at most 2048 pixels on a side\. /),
      ])
      expect(limited.problems[0]).toMatch(/^scenes\/arm\.yaml, line 5: object 'big': the model is 5\.0001 MB; a model may be at most 5 MB\. /)
    })

    it('checks a file shared by a scene file with limits: off and one without for each, showing it to the objects it passes for', async () => {
      const loaded = await loadModels(
        [
          ref('big', 'models/big.stl', 5, 'm', 'default', 'off'),
          ref('poster', 'models/poster.glb', 9, 'm', 'file', 'off'),
          // in scenes/agilus.yaml, which keeps the limits: refused there, at their own lines
          ref('big', 'models/big.stl', 7, 'm', 'default', 'on', 'scenes/agilus.yaml'),
          ref('poster', 'models/poster.glb', 11, 'm', 'file', 'on', 'scenes/agilus.yaml'),
          ref('grey', 'models/poster.glb', 13, 'm', 'preset', 'on', 'scenes/agilus.yaml'),
        ],
        read,
      )
      expect(loaded.files).toEqual({ 'models/big.stl': big, 'models/poster.glb': poster })
      expect(loaded.leftOut).toEqual(['scenes/agilus.yaml big', 'scenes/agilus.yaml poster'])
      expect(loaded.problems).toEqual([
        expect.stringMatching(/^scenes\/agilus\.yaml, line 7: object 'big': the model is 5\.0001 MB; a model may be at most 5 MB\. /),
        expect.stringMatching(/^scenes\/agilus\.yaml, line 11: object 'poster': the model's image 'poster' is 4096 x 4096 pixels: /),
      ])
      // the deck's loader finds the objects left out by scene file and name (deck-from-source.ts)
      const scenes = readSceneFiles({
        'scenes/arm.yaml': 'base: arm\nlimits: off\nobjects:\n  big:\n    model: models/big.stl\n',
        'scenes/agilus.yaml': 'base: agilus\nobjects:\n  big:\n    model: models/big.stl\n',
      })
      const keys = [...scenes.values()].flatMap((file) => file.models.map((m) => `${m.file} ${m.object}`))
      expect(keys.filter((key) => loaded.leftOut.includes(key))).toEqual(['scenes/agilus.yaml big'])
    })

    it('still refuses what is wrong with the file', async () => {
      const loaded = await loadModels([ref('pane', 'models/glass.glb', 3, 'm', 'file', 'off')], read)
      expect(loaded.files).toEqual({})
      expect(loaded.problems).toEqual([expect.stringMatching(/^scenes\/arm\.yaml, line 3: object 'pane': the model's material 'glass' is see-through \(blended/)])
    })

    it('tells a changed limits: line in a scene file with models, which only loading the panel afresh checks again', () => {
      const arm = (top: string) => readSceneFiles({ 'scenes/arm.yaml': `base: arm\n${top}objects:\n  big:\n    model: models/big.stl\n`, 'scenes/agilus.yaml': 'base: agilus\n' })
      expect(limitsChanged(arm(''), arm('limits: off\n'))).toBe(true)
      expect(limitsChanged(arm('limits: off\n'), arm(''))).toBe(true)
      expect(limitsChanged(arm('limits: off\n'), arm('limits: off   # for testing\n'))).toBe(false)
      expect(limitsChanged(arm(''), arm('# a comment\n'))).toBe(false)
      // a file without models has nothing to check again
      const plain = (top: string) => readSceneFiles({ 'scenes/arm.yaml': `base: arm\n${top}` })
      expect(limitsChanged(plain(''), plain('limits: off\n'))).toBe(false)
    })
  })

  it('asks for nothing when no scene a slide runs has a model', async () => {
    const { asked, read } = host({})
    expect(await loadModels([], read)).toEqual({ files: {}, problems: [], leftOut: [] })
    expect(asked).toEqual([])
  })
})
