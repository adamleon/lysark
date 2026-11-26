import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { modelBytesProblem } from '../compiler/model-types'
import { binaryStl, box, glb, glbEdits, jpeg, lfsPointer, overLimitStl, png, textStl, UNIT_CUBE } from './model-test-files.js'
import { checkModel } from './model-check'

// the bytes' check as it is, but one a test can make pass a file it refuses
vi.mock('../compiler/model-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../compiler/model-types')>()
  return { ...actual, modelBytesProblem: vi.fn(actual.modelBytesProblem) }
})

// The checks that need a parse (B10-B13 in the step 8 design); those on the
// bytes alone (B1-B9) are src/compiler/model-types.test.ts's, and only pass through here.

describe('checkModel', () => {
  it('passes good STL and GLB files', async () => {
    expect(await checkModel(binaryStl(), 'stl', ['m'])).toBeNull()
    expect(await checkModel(textStl(), 'stl', ['m'])).toBeNull()
    expect(await checkModel(glb({ meshes: [{}, { translation: [1, 0, 0] }] }), 'glb', ['m'])).toBeNull()
    // a 100 mm part, read in millimetres
    expect(await checkModel(binaryStl(box([0, 0, 0], [100, 40, 20])), 'stl', ['mm'])).toBeNull()
  })

  it('refuses what the bytes say before parsing', async () => {
    expect(await checkModel(lfsPointer(), 'stl', ['m'])).toMatch(/^the model is a Git LFS pointer/)
    expect(await checkModel(glb({ edits: [glbEdits.image()] }), 'glb', ['m'])).toMatch(/^the model has textures/)
  })

  it('refuses a model with no triangles (B10)', async () => {
    const none = 'the model has no triangles to show'
    expect(await checkModel(binaryStl([]), 'stl', ['m'])).toBe(none)
    expect(await checkModel(glb({ meshes: [] }), 'glb', ['m'])).toBe(none)
    // lines and points are left out, so a file of only those has nothing to show
    expect(await checkModel(glb({ meshes: [{ mode: 1 }, { mode: 0 }] }), 'glb', ['m'])).toBe(none)
    // a binary STL whose header starts with 'solid' and has the wrong count is read as text
    const solid = `${none} (a binary STL whose header starts with 'solid' is read as text: export it again)`
    expect(await checkModel(binaryStl(UNIT_CUBE, { header: 'solid part', count: 0 }), 'stl', ['m'])).toBe(solid)
    // shorter than a binary STL's header: STLLoader alone would throw
    expect(await checkModel(textStl([]), 'stl', ['m'])).toBe(solid)
  })

  it('refuses a model too large or too small in its unit (B11, B12)', async () => {
    const part = binaryStl(box([0, 0, 0], [412, 30, 10]))
    expect(await checkModel(part, 'stl', ['m'])).toBe('the model is 412 m across, read in m. Is the file in millimetres? Write unit: mm')
    expect(await checkModel(part, 'stl', ['mm'])).toBeNull()
    // every object that shows the file reads it in its own unit
    expect(await checkModel(part, 'stl', ['mm', 'm'])).toMatch(/^the model is 412 m across, read in m/)
    expect(await checkModel(binaryStl(box([0, 0, 0], [15000, 1, 1])), 'stl', ['mm'])).toBe('the model is 15 m across even read in mm: check unit')
    expect(await checkModel(binaryStl(box([0, 0, 0], [0.4, 0.1, 0.1])), 'stl', ['mm'])).toBe(
      'the model is 0.4 mm across, read in mm. Is the file in metres? Leave out unit',
    )
    // the size of the whole model, with its node transforms
    expect(await checkModel(glb({ meshes: [{}, { translation: [11, 0, 0] }] }), 'glb', ['m'])).toMatch(/^the model is 12 m across, read in m/)
  })

  it("passes on the loader's own message when it can't read the file (B13)", async () => {
    // the bytes look right, but the positions run past the end of the data
    const short = glb({ edits: [(json) => (json.accessors[0].count = 1000)] })
    expect(await checkModel(short, 'glb', ['m'])).toMatch(/^the model couldn't be read: \S[^\n]*$/)
    // STLLoader only logs a text STL's broken face, and reads on: here it is refused, and nothing is logged
    const error = vi.spyOn(console, 'error')
    const text = new TextDecoder().decode(textStl())
    const missing = text.replace(/ {6}vertex [^\n]*\n {4}endloop/, '    endloop')
    expect(await checkModel(new TextEncoder().encode(missing).buffer, 'stl', ['m'])).toBe(
      "the model couldn't be read: THREE.STLLoader: Something isn't right with the vertices of face number 0",
    )
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('refuses bones and GPU instancing in what the loader built, whatever the JSON says (B8)', async () => {
    const bones = "the model has bones (a skin), which a lecture can't show: apply the armature, or export without it"
    // isSkinnedMesh on a mesh isn't glTF, and the bytes' check doesn't look for it: GLTFLoader makes a SkinnedMesh
    const skinned = glb({ edits: [glbEdits.skinnedMesh()] })
    expect(modelBytesProblem(skinned, 'glb')).toBeNull()
    expect(await checkModel(skinned, 'glb', ['m'])).toBe(bones)
    // no layout of the JSON gets instancing past the bytes' check: here it is made to pass one
    const instanced = glb({ edits: [glbEdits.instancedNode()] })
    vi.mocked(modelBytesProblem).mockReturnValueOnce(null)
    expect(await checkModel(instanced, 'glb', ['m'])).toBe('the model uses GPU instancing: export it without GPU instances')
  })

  describe('with material: file (step 9)', () => {
    const textured = () =>
      glb({
        meshes: [{ name: 'box', uvs: true, material: 0 }],
        materials: [{ name: 'label', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
        textures: [{ name: 'label', bytes: png(4, 4) }],
      })

    it('checks a textured GLB without loading its images, which Node has no <img> for, and asks how it looks without a material: line', async () => {
      expect(await checkModel(textured(), 'glb', ['m'], 'file')).toBeNull()
      expect(await checkModel(textured(), 'glb', ['m'], 'preset')).toBeNull()
      expect(await checkModel(textured(), 'glb', ['m'])).toMatch(/^the model has textures: write material: file to show them/)
      // the image's size is read from its header: one too large is refused before the parse
      const large = glb({
        meshes: [{ uvs: true, material: 0 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
        textures: [{ name: 'photo', bytes: jpeg(3000, 2000), mimeType: 'image/jpeg' }],
      })
      expect(await checkModel(large, 'glb', ['m'], 'file')).toMatch(
        /^the model's image 'photo' is 3000 x 2000 pixels: a texture may be at most 2048 pixels on a side\. Scale the image down/,
      )
    })

    it('names the file whose textures are too many pixels in all, from their headers too', async () => {
      const sizes = [2048, 2048, 2048, 2048, 64]
      const photos = glb({
        meshes: sizes.map((_, k) => ({ uvs: true, material: k })),
        materials: sizes.map((_, k) => ({ pbrMetallicRoughness: { baseColorTexture: { index: k }, metallicFactor: 0 } })),
        textures: sizes.map((side) => ({ bytes: jpeg(side, side), mimeType: 'image/jpeg' })),
      })
      expect(await checkModel(photos, 'glb', ['m'], 'file', '../../assets/photos.glb')).toMatch(
        /^the model '\.\.\/\.\.\/assets\/photos\.glb' has 16,781,312 pixels of textures in all \(5 images\); a model may have at most 16,777,216,/,
      )
      expect(await checkModel(photos, 'glb', ['m'], 'preset', '../../assets/photos.glb')).toBeNull()
    })

    it('refuses a see-through material in what the loader built, whatever the JSON says', async () => {
      const glass = glb({ meshes: [{ name: 'pane', material: 0 }], materials: [{ name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { metallicFactor: 0 } }] })
      expect(await checkModel(glass, 'glb', ['m'], 'file')).toMatch(/^the model's material 'glass' is see-through \(blended/)
      // made to pass the bytes' check, the built material is refused
      vi.mocked(modelBytesProblem).mockReturnValueOnce(null)
      expect(await checkModel(glass, 'glb', ['m'], 'file')).toBe(
        "the model's material 'glass' is see-through, which the stage draws wrong or not at all: " +
          "make it opaque in the program that made it (in Blender, the Principled BSDF's Alpha at 1, with nothing linked to it), " +
          "or for a transparent surround, such as a sticker's, use alpha clip (in Blender, a Math node set to Round between " +
          "the texture's Alpha and the Principled BSDF's Alpha); or write a colour such as material: grey",
      )
      // transmission isn't a surround to cut out
      const clear = glb({ meshes: [{ material: 0 }], materials: [{ name: 'clear', pbrMetallicRoughness: { metallicFactor: 0 }, extensions: { KHR_materials_transmission: { transmissionFactor: 1 } } }] })
      vi.mocked(modelBytesProblem).mockReturnValueOnce(null)
      expect(await checkModel(clear, 'glb', ['m'], 'file')).toMatch(/^the model's material 'clear' is see-through, which the stage draws wrong or not at all: make it opaque .*Alpha at 1, with nothing linked to it\), or write a colour/)
      // with a preset the file's materials are replaced
      expect(await checkModel(glass, 'glb', ['m'], 'preset')).toBeNull()
    })

    it('passes a cut-out material (alpha mode MASK), which three draws in the opaque pass', async () => {
      const sticker = glb({
        meshes: [{ name: 'sticker', uvs: true, material: 0 }],
        materials: [{ name: 'sticker', alphaMode: 'MASK', alphaCutoff: 0.4, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
        textures: [{ bytes: png(4, 4, () => [200, 30, 30, 0], { alpha: true }) }],
      })
      expect(await checkModel(sticker, 'glb', ['m'], 'file')).toBeNull()
    })
  })

  describe('with limits: off (decision 11)', () => {
    it('parses and passes a file over 5 MB, and still checks its unit, which is no size limit', async () => {
      const big = overLimitStl()
      expect(await checkModel(big, 'stl', ['m'], 'default', 'models/big.stl', 'off')).toBeNull()
      expect(await checkModel(big, 'stl', ['m'], 'default', 'models/big.stl')).toMatch(/^the model is 5\.0001 MB; a model may be at most 5 MB\. /)
      // 0.1 across in its units: in mm, a tenth of a millimetre
      expect(await checkModel(big, 'stl', ['mm'], 'default', 'models/big.stl', 'off')).toBe(
        'the model is 0.1 mm across, read in mm. Is the file in metres? Leave out unit',
      )
    })

    it('passes textures over 2048 pixels on a side and over the total, and still refuses a see-through material', async () => {
      const sides = [4096, 4096, 2048]
      const photos = glb({
        meshes: sides.map((_, k) => ({ uvs: true, material: k })),
        materials: sides.map((_, k) => ({ pbrMetallicRoughness: { baseColorTexture: { index: k }, metallicFactor: 0 } })),
        textures: sides.map((side) => ({ bytes: jpeg(side, side), mimeType: 'image/jpeg' })),
      })
      expect(await checkModel(photos, 'glb', ['m'], 'file', 'models/photos.glb')).toMatch(/^the model's image number 1 is 4096 x 4096 pixels/)
      expect(await checkModel(photos, 'glb', ['m'], 'file', 'models/photos.glb', 'off')).toBeNull()
      const glass = glb({ meshes: [{ name: 'pane', material: 0 }], materials: [{ name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { metallicFactor: 0 } }] })
      expect(await checkModel(glass, 'glb', ['m'], 'file', 'models/glass.glb', 'off')).toMatch(/^the model's material 'glass' is see-through \(blended/)
      // and in what the loader built, made to pass the bytes' check
      vi.mocked(modelBytesProblem).mockReturnValueOnce(null)
      expect(await checkModel(glass, 'glb', ['m'], 'file', 'models/glass.glb', 'off')).toMatch(/^the model's material 'glass' is see-through, which the stage draws wrong/)
    })
  })

  it('never rejects: what throws after the parse is a file that couldn\'t be read (B13)', async () => {
    const measure = vi.spyOn(THREE.Box3.prototype, 'setFromObject').mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getX')")
    })
    expect(await checkModel(glb(), 'glb', ['m'])).toBe("the model couldn't be read: Cannot read properties of undefined (reading 'getX')")
    measure.mockRestore()
  })
})
