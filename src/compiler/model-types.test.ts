import { describe, expect, it } from 'vitest'
import {
  binaryStl,
  box,
  glb,
  glbChunk,
  glbEdits,
  jpeg,
  lfsPointer,
  png,
  textStl,
  withExtraByte,
  withGlbTail,
  type GlbEdit,
  type GlbMesh,
  type GlbTexture,
} from '../scene/model-test-files.js'
import {
  jpegSize,
  MAX_FILE_METALNESS,
  MAX_TEXTURE_PIXELS,
  MAX_TEXTURE_TOTAL_PIXELS,
  MIN_MODEL_METRES,
  MODEL_MAX_BYTES,
  MODEL_TEXTURES_UNCHOSEN,
  MODEL_UNITS,
  modelBytesProblem,
  modelExtentProblem,
  modelFormat,
  modelObjectKey,
  modelPathProblem,
  modelSizeAdvice,
  modelSizeProblem,
  modelWhere,
  pngSize,
} from './model-types'

/** a box with one texture on it, as an exporter writes one: texture coordinates, a material using the texture, a PNG */
function textureBox(texture: Partial<GlbTexture> = {}, edit?: GlbEdit): ArrayBuffer {
  return glb({
    meshes: [{ name: 'box', uvs: true, material: 0 }],
    materials: [{ name: 'label', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    textures: [{ name: 'label', bytes: png(4, 4), ...texture }],
    edits: edit ? [edit] : [],
  })
}

describe('model files (scene-files-proposal.md step 8)', () => {
  it('knows a model by its extension, in any case', () => {
    expect(modelFormat('models/bracket.stl')).toBe('stl')
    expect(modelFormat('../../assets/Bracket.STL')).toBe('stl')
    expect(modelFormat('models/tray.glb')).toBe('glb')
    expect(modelFormat('models/tray.GLB')).toBe('glb')
    expect(modelFormat('models/tray.gltf')).toBeUndefined()
    expect(modelFormat('models/bracket')).toBeUndefined()
    // a dot in a folder's name is not an extension
    expect(modelFormat('models.stl/bracket')).toBeUndefined()
    expect(modelFormat('models/.constructor')).toBeUndefined()
  })

  it('names a model object by its scene file and name', () => {
    expect(modelObjectKey({ file: 'scenes/arm.yaml', object: 'marker' })).toBe('scenes/arm.yaml marker')
    expect(modelObjectKey({ file: 'scenes/arm.yaml', object: 'grey crate' })).toBe('scenes/arm.yaml grey crate')
  })

  it('has the units, the size limit and the smallest model', () => {
    expect(MODEL_UNITS).toEqual({ mm: 0.001, cm: 0.01, m: 1 })
    expect(MODEL_MAX_BYTES).toBe(5_000_000)
    expect(MIN_MODEL_METRES).toBe(0.001)
  })

  it('names where a model is written, as a compile error does', () => {
    expect(modelWhere({ file: 'scenes/arm.yaml', line: 12, object: 'bracket' })).toBe("scenes/arm.yaml, line 12: object 'bracket'")
  })
})

describe('modelPathProblem: the path as written (C2-C7)', () => {
  it('takes a path from the lecture folder, to a file in it or in the course assets', () => {
    for (const src of ['models/bracket.stl', '../../assets/bracket.STL', './tray.glb', 'models/my part.stl', 'models/a%5cb.stl']) {
      expect(modelPathProblem(src)).toBeNull()
    }
  })

  it('refuses an absolute path (C2)', () => {
    expect(modelPathProblem('C:/Users/adam/bracket.stl')).toBe(
      "model 'C:/Users/adam/bracket.stl' is an absolute path on this computer: copy the file into the lecture folder (for example models/) " +
        "or the course's assets/ folder, and give the path from the lecture folder",
    )
    expect(modelPathProblem('c:\\cad\\bracket.stl')).toMatch(/^model 'c:\\cad\\bracket\.stl' is an absolute path on this computer/)
    expect(modelPathProblem('\\\\server\\cad\\bracket.stl')).toMatch(/is an absolute path on this computer/)
  })

  it('refuses a web address (C3)', () => {
    expect(modelPathProblem('https://example.com/bracket.stl')).toBe(
      "model 'https://example.com/bracket.stl' is a web address. The lecture file must work offline: save the file into the lecture folder " +
        "or the course's assets/ folder and give its path",
    )
    expect(modelPathProblem('//example.com/bracket.stl')).toMatch(/is a web address/)
    expect(modelPathProblem('data:model/stl;base64,AAAA')).toMatch(/is a web address/)
  })

  it('refuses a backslash, showing the path with / (C4)', () => {
    expect(modelPathProblem('models\\bracket.stl')).toBe("model 'models\\bracket.stl' contains a backslash: use /, such as models/bracket.stl")
    expect(modelPathProblem('..\\..\\assets\\bracket.stl')).toMatch(/such as \.\.\/\.\.\/assets\/bracket\.stl$/)
  })

  it("refuses a leading '/' (C5)", () => {
    expect(modelPathProblem('/models/bracket.stl')).toBe(
      "model '/models/bracket.stl' starts with '/': give the path from the lecture folder, such as models/bracket.stl",
    )
  })

  it('refuses glTF as text (C6)', () => {
    expect(modelPathProblem('models/tray.gltf')).toBe(
      "model 'models/tray.gltf' is glTF as text, which keeps its data in other files: export it as binary glTF (.glb)",
    )
    expect(modelPathProblem('models/tray.GLTF')).toMatch(/is glTF as text/)
  })

  it('refuses any other file (C7)', () => {
    for (const src of ['models/bracket.step', 'models/bracket.stp', 'models/bracket.obj', 'x.dae', 'x.fbx', 'x.3mf', 'x.ply', 'models/bracket', 'models.stl/x']) {
      expect(modelPathProblem(src)).toBe(`model '${src}' isn't a file a lecture can show: export it from the CAD program as .stl (binary) or .glb`)
    }
  })

  // extension 0.3.0's resolveInside (extension/src/logic.ts) refuses these, and it can't change
  describe("refuses a name VS Code's panel won't read, which the build would", () => {
    it("takes '.' and '..' as folders, and a dot inside a name", () => {
      for (const src of ['../../assets/x.stl', './models/x.stl', 'models/v1.2/x.stl', 'models/./x.stl', 'models/x.v2.glb', 'models/a~b.stl']) {
        expect(modelPathProblem(src)).toBeNull()
      }
    })

    it("refuses a folder or file starting with '.'", () => {
      expect(modelPathProblem('.cad/bracket.stl')).toBe(
        "model '.cad/bracket.stl' has a folder name starting with '.' ('.cad'), which VS Code's panel won't read: rename the folder",
      )
      expect(modelPathProblem('models/.bracket.stl')).toBe(
        "model 'models/.bracket.stl' has a file name starting with '.' ('.bracket.stl'), which VS Code's panel won't read: rename the file",
      )
      expect(modelPathProblem('../../assets/.git/x.stl')).toMatch(/has a folder name starting with '\.' \('\.git'\)/)
      expect(modelPathProblem('models/.../x.stl')).toMatch(/has a folder name starting with '\.' \('\.\.\.'\)/)
    })

    it('refuses a name with ~ and a digit, as Windows short names have', () => {
      expect(modelPathProblem('models/bracket~1.stl')).toBe(
        "model 'models/bracket~1.stl' has a file name with ~ and a digit ('bracket~1.stl'), like a Windows short name, " +
          "which VS Code's panel won't read: rename the file",
      )
      expect(modelPathProblem('CAD~12/bracket.stl')).toMatch(/has a folder name with ~ and a digit \('CAD~12'\)/)
    })

    it('refuses a colon, after the drive letter and web address messages', () => {
      expect(modelPathProblem('models/a:b.stl')).toBe(
        "model 'models/a:b.stl' has a file name with a colon ('a:b.stl'), which VS Code's panel won't read: rename the file",
      )
      expect(modelPathProblem('my parts:v2/bracket.stl')).toMatch(/has a folder name with a colon \('my parts:v2'\)/)
      expect(modelPathProblem('./c:x.stl')).toMatch(/has a file name with a colon/)
      expect(modelPathProblem('C:/cad/bracket.stl')).toMatch(/is an absolute path on this computer/)
      expect(modelPathProblem('https://example.com/.cad/bracket~1.stl')).toMatch(/is a web address/)
    })
  })
})

describe('modelSizeProblem and modelBytesProblem: the file (B1-B9)', () => {
  const tooLarge =
    'a model may be at most 5 MB. Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)'

  it('passes the test STL and GLB files, and what the loader leaves out without an error', () => {
    expect(modelBytesProblem(binaryStl(), 'stl')).toBeNull()
    expect(modelBytesProblem(textStl(), 'stl')).toBeNull()
    expect(modelBytesProblem(glb(), 'glb')).toBeNull()
    expect(modelBytesProblem(glb({ meshes: [{}, { mode: 1 }, { mode: 0, normals: false }], edits: [glbEdits.light(), glbEdits.camera()] }), 'glb')).toBeNull()
    // nothing to show is told after the parse (B10, src/scene/model-check.ts)
    expect(modelBytesProblem(binaryStl([]), 'stl')).toBeNull()
    expect(modelBytesProblem(glb({ meshes: [] }), 'glb')).toBeNull()
  })

  it('refuses a file over the limit (B1), and says how much over', () => {
    expect(modelSizeProblem(MODEL_MAX_BYTES, 'stl')).toBeNull()
    expect(modelSizeProblem(7_300_000, 'stl')).toBe(`the model is 7.3 MB; ${tooLarge}`)
    expect(modelSizeProblem(5_040_000, 'stl')).toBe(`the model is 5.04 MB; ${tooLarge}`)
    expect(modelSizeProblem(MODEL_MAX_BYTES + 1, 'stl')).toBe(`the model is 5.000001 MB; ${tooLarge}`)
    expect(modelBytesProblem(new ArrayBuffer(MODEL_MAX_BYTES + 1), 'stl')).toBe(`the model is 5.000001 MB; ${tooLarge}`)
    expect(modelBytesProblem(new ArrayBuffer(MODEL_MAX_BYTES + 1), 'glb')).toMatch(/^the model is 5\.000001 MB/)
  })

  it("advises a GLB over the limit about its textures, which count in it (a 2048-pixel PNG photo alone can be 5 MB)", () => {
    const glbAdvice =
      'a model may be at most 5 MB, its textures included. Export it with fewer triangles, or its textures as JPEG rather than PNG ' +
      "(in Blender's glTF export, under Data > Material, Images: JPEG Format) or smaller"
    expect(modelSizeAdvice('glb')).toBe(glbAdvice)
    expect(modelSizeAdvice('stl')).toBe(tooLarge)
    expect(modelSizeProblem(5_500_000, 'glb')).toBe(`the model is 5.5 MB; ${glbAdvice}`)
    expect(modelBytesProblem(new ArrayBuffer(MODEL_MAX_BYTES + 1), 'glb')).toBe(`the model is 5.000001 MB; ${glbAdvice}`)
  })

  it('refuses a Git LFS pointer (B2)', () => {
    const message =
      "the model is a Git LFS pointer, not the model: the course build doesn't fetch LFS files. Keep the file in git itself (git lfs untrack, then commit it again)"
    expect(modelBytesProblem(lfsPointer(), 'stl')).toBe(message)
    expect(modelBytesProblem(lfsPointer(), 'glb')).toBe(message)
  })

  it('refuses an STL that is neither binary nor text, as STLLoader tells them apart (B3)', () => {
    const message = "the model isn't an STL file: a binary STL is 84 bytes plus 50 per triangle, and a text STL starts with 'solid'. Export it again"
    expect(modelBytesProblem(withExtraByte(binaryStl()), 'stl')).toBe(message)
    expect(modelBytesProblem(new ArrayBuffer(0), 'stl')).toBe(message)
    expect(modelBytesProblem(glb(), 'stl')).toBe(message)
    // binary by its length, whatever its header says
    expect(modelBytesProblem(binaryStl(box([0, 0, 0], [1, 1, 1]), { header: 'solid part' }), 'stl')).toBeNull()
    // text after a byte order mark; with a count that doesn't fit, a 'solid' header reads as text (B10 is after the parse)
    const text = new Uint8Array(textStl())
    const marked = new Uint8Array(text.length + 3)
    marked.set([0xef, 0xbb, 0xbf])
    marked.set(text, 3)
    expect(modelBytesProblem(marked.buffer, 'stl')).toBeNull()
    expect(modelBytesProblem(binaryStl(undefined, { header: 'solid part', count: 0 }), 'stl')).toBeNull()
  })

  it("refuses a .glb that isn't binary glTF 2.0 (B4)", () => {
    const message = "the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)"
    const patched = (offset: number, value: number) => {
      const bytes = glb()
      new DataView(bytes).setUint32(offset, value, true)
      return bytes
    }
    expect(modelBytesProblem(binaryStl(), 'glb')).toBe(message)
    expect(modelBytesProblem(new ArrayBuffer(12), 'glb')).toBe(message)
    expect(modelBytesProblem(withExtraByte(glb()), 'glb')).toBe(message)
    expect(modelBytesProblem(patched(0, 0x46546c66), 'glb')).toBe(message) // not 'glTF'
    expect(modelBytesProblem(patched(4, 1), 'glb')).toBe(message) // the GLB version
    expect(modelBytesProblem(patched(16, 0x004e4942), 'glb')).toBe(message) // a binary chunk first
    expect(modelBytesProblem(patched(12, 1_000_000), 'glb')).toBe(message) // a JSON chunk longer than the file
    expect(modelBytesProblem(glb({ edits: [glbEdits.version('1.0')] }), 'glb')).toBe(message)
    // JSON that doesn't parse
    const broken = glb()
    new Uint8Array(broken)[20] = 0x7d // '}'
    expect(modelBytesProblem(broken, 'glb')).toBe(message)
  })

  it('walks every chunk as GLTFLoader does (B4)', () => {
    const message = "the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)"
    // GLTFLoader keeps the last JSON chunk: a second one would be read in place of the one checked
    const outside = { asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'https://example.invalid/model.bin' }] }
    expect(modelBytesProblem(withGlbTail(glb(), glbChunk('JSON', outside)), 'glb')).toBe(message)
    expect(modelBytesProblem(withGlbTail(glb({ meshes: [] }), glbChunk('JSON', outside)), 'glb')).toBe(message)
    // a chunk longer than what is left of the file, and a chunk's start without its type
    expect(modelBytesProblem(withGlbTail(glb(), glbChunk('BIN', new Uint8Array(4), { length: 100 })), 'glb')).toBe(message)
    expect(modelBytesProblem(withGlbTail(glb(), new Uint8Array(4)), 'glb')).toBe(message)
    const shortBinary = glb()
    new DataView(shortBinary).setUint32(new DataView(shortBinary).getUint32(12, true) + 20, 1_000_000, true)
    expect(modelBytesProblem(shortBinary, 'glb')).toBe(message)
  })

  it('refuses a list GLTFLoader reads written as anything else (B4)', () => {
    const message = "the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)"
    // GLTFLoader indexes it as it would a list and fetches the address: read as a list, nothing would be refused
    const objectBuffers = glb({
      edits: [
        (json) => {
          json.buffers = { 0: { byteLength: json.buffers[0].byteLength, uri: 'data:application/octet-stream;base64,AAAA' } }
        },
      ],
    })
    expect(modelBytesProblem(objectBuffers, 'glb')).toBe(message)
    const lists = ['accessors', 'animations', 'buffers', 'bufferViews', 'cameras', 'extensionsRequired', 'extensionsUsed', 'images']
    lists.push('materials', 'meshes', 'nodes', 'samplers', 'scenes', 'skins', 'textures')
    for (const name of lists) {
      for (const value of [{}, { 0: {} }, 'x', 0, null]) {
        expect(modelBytesProblem(glb({ edits: [(json) => (json[name] = value)] }), 'glb'), `${name}: ${JSON.stringify(value)}`).toBe(message)
      }
    }
    // a buffer view of any buffer but 0, the GLB's own: as '0', GLTFLoader fetches ''
    expect(modelBytesProblem(glb({ edits: [(json) => (json.bufferViews[0].buffer = '0')] }), 'glb')).toBe(message)
    expect(modelBytesProblem(glb({ edits: [(json) => delete json.bufferViews[0].buffer] }), 'glb')).toBe(message)
  })

  it('asks how a GLB with textures looks when its object has no material: line (B5, decision 10)', () => {
    const message =
      "the model has textures: write material: file to show them, with the file's own colours, or a colour such as material: grey to colour it all with that"
    expect(MODEL_TEXTURES_UNCHOSEN).toBe(message)
    const textured = [
      glb({ edits: [glbEdits.image()] }),
      glb({ edits: [(json) => (json.textures = [{}])] }),
      ...['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif'].map((name) => glb({ edits: [glbEdits.extension(name, false)] })),
      textureBox(),
    ]
    for (const file of textured.slice(0, 2)) expect(modelBytesProblem(file, 'glb')).toBe(message)
    expect(modelBytesProblem(textureBox(), 'glb')).toBe(message)
    // textures material: file couldn't show either are said at once, not after material: file is written
    const blender = "in Blender's glTF export, under Data > Material, Images: JPEG Format, with Create WebP off"
    for (const [k, [name, kind]] of [
      ['KHR_texture_basisu', 'KTX2'],
      ['EXT_texture_webp', 'WebP'],
      ['EXT_texture_avif', 'AVIF'],
    ].entries()) {
      expect(modelBytesProblem(textured[2 + k], 'glb')).toBe(
        `the model's textures are ${kind} (${name}), which a lecture can't show: export the textures as PNG or JPEG (${blender}), ` +
          'and write material: file to show them, or a colour such as material: grey to colour it all with that',
      )
    }
    // with a preset, its materials and textures are left out, whatever they are
    for (const file of textured) expect(modelBytesProblem(file, 'glb', 'preset')).toBeNull()
    expect(modelBytesProblem(glb({ edits: [glbEdits.extension('KHR_texture_basisu')] }), 'glb', 'preset')).toBeNull()
    // and a GLB without textures has no need to say
    expect(modelBytesProblem(glb({ materials: [{ pbrMetallicRoughness: { metallicFactor: 1 } }] }), 'glb')).toBeNull()
  })

  it('refuses data outside the file (B6)', () => {
    const message = 'the model keeps data outside the .glb (in another file or a data: address): export it as one self-contained .glb'
    expect(modelBytesProblem(glb({ edits: [glbEdits.bufferUri()] }), 'glb')).toBe(message)
    expect(modelBytesProblem(glb({ edits: [glbEdits.twoBuffers()] }), 'glb')).toBe(message)
  })

  it('refuses compression, naming it, before the required-extension message (B7)', () => {
    for (const name of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression']) {
      expect(modelBytesProblem(glb({ edits: [glbEdits.extension(name)] }), 'glb')).toBe(
        `the model is compressed (${name}), which the lecture file can't unpack offline: export it without compression`,
      )
    }
    // GLTFLoader reads a meshopt buffer view whatever extensionsUsed lists, and asks for the buffer it names
    const meshopt = glb({ edits: [(json) => (json.bufferViews[0].extensions = { EXT_meshopt_compression: { buffer: '0', byteLength: 4 } })] })
    expect(modelBytesProblem(meshopt, 'glb')).toBe(
      "the model is compressed (EXT_meshopt_compression), which the lecture file can't unpack offline: export it without compression",
    )
  })

  it('refuses bones and GPU instancing (B8)', () => {
    const bones = "the model has bones (a skin), which a lecture can't show: apply the armature, or export without it"
    const instancing = 'the model uses GPU instancing: export it without GPU instances'
    expect(modelBytesProblem(glb({ edits: [glbEdits.skin()] }), 'glb')).toBe(bones)
    expect(modelBytesProblem(glb({ edits: [glbEdits.extension('EXT_mesh_gpu_instancing')] }), 'glb')).toBe(instancing)
    // on a node, as GLTFLoader reads them: a skin without skins, and instancing extensionsUsed doesn't list
    expect(modelBytesProblem(glb({ edits: [(json) => (json.nodes[0].skin = 0)] }), 'glb')).toBe(bones)
    expect(modelBytesProblem(glb({ edits: [glbEdits.instancedNode()] }), 'glb')).toBe(instancing)
  })

  it('refuses a required extension lysark does not read, and allows the ones it can do without (B9)', () => {
    expect(modelBytesProblem(glb({ edits: [glbEdits.extension('EXT_structural_metadata')] }), 'glb')).toBe(
      "the model needs the glTF extension 'EXT_structural_metadata', which lysark doesn't read: export it without it",
    )
    for (const name of ['KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_materials_transmission', 'KHR_texture_transform', 'KHR_lights_punctual']) {
      expect(modelBytesProblem(glb({ edits: [glbEdits.extension(name)] }), 'glb')).toBeNull()
    }
    // only used, not required: the loader does without it
    expect(modelBytesProblem(glb({ edits: [glbEdits.extension('EXT_structural_metadata', false)] }), 'glb')).toBeNull()
  })
})

describe('material: file, a GLB in its own colours and textures (step 9, decision 10)', () => {
  const notGlb = "the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)"
  const own = (file: ArrayBuffer) => modelBytesProblem(file, 'glb', 'file')
  /** a box with one material, its own colour, as an exporter writes it */
  const coloured = (material: Record<string, unknown>, mesh: Partial<GlbMesh> = {}) => glb({ meshes: [{ material: 0, ...mesh }], materials: [material] })

  it('passes a textured box in PNG or JPEG, up to 2048 pixels on a side, and one in its own colours', () => {
    expect(MAX_TEXTURE_PIXELS).toBe(2048)
    expect(own(textureBox())).toBeNull()
    expect(own(textureBox({ bytes: jpeg(16, 16), mimeType: 'image/jpeg' }))).toBeNull()
    expect(own(textureBox({ bytes: png(2048, 1) }))).toBeNull()
    expect(own(textureBox({ bytes: png(1, 2048) }))).toBeNull()
    expect(own(textureBox({ bytes: jpeg(2048, 2048), mimeType: 'image/jpeg' }))).toBeNull()
    expect(own(coloured({ name: 'blue', pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1], metallicFactor: 0 } }))).toBeNull()
    // one image used by two textures, and a texture by two materials
    const shared = textureBox({}, (json) => {
      json.textures.push({ source: 0 })
      json.materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0 }, normalTexture: { index: 0 } })
      json.meshes[0].primitives.push({ ...json.meshes[0].primitives[0], material: 1 })
    })
    expect(own(shared)).toBeNull()
  })

  it('refuses an image over 2048 pixels on a side, naming it and its size', () => {
    const smaller =
      "a texture may be at most 2048 pixels on a side. Scale the image down (in Blender's Image Editor, Image > Resize, then Image > Save) " +
      'and export again, or write a colour such as material: grey'
    expect(own(textureBox({ name: 'label', bytes: png(2049, 1) }))).toBe(`the model's image 'label' is 2049 x 1 pixels: ${smaller}`)
    // the size from a JPEG's frame header, a progressive one's too; an image without a name by its place
    expect(own(textureBox({ name: '', bytes: jpeg(4096, 3072, { frame: 0xc2 }), mimeType: 'image/jpeg' }))).toBe(
      `the model's image number 1 is 4096 x 3072 pixels: ${smaller}`,
    )
  })

  describe('a total of texture pixels per file (the author, 2026-11-26)', () => {
    /** a box for each image, its material showing that image (a JPEG: a few kB in the file at any size) */
    const photos = (sizes: Array<[number, number]>, edit?: GlbEdit) =>
      glb({
        meshes: sizes.map((_, k): GlbMesh => ({ uvs: true, material: k, translation: [2 * k, 0, 0] })),
        materials: sizes.map((_, k) => ({ name: `photo ${k + 1}`, pbrMetallicRoughness: { baseColorTexture: { index: k }, metallicFactor: 0 } })),
        textures: sizes.map(([width, height], k) => ({ name: `photo ${k + 1}`, bytes: jpeg(width, height), mimeType: 'image/jpeg' })),
        edits: edit ? [edit] : [],
      })
    const full = (): Array<[number, number]> => [
      [2048, 2048],
      [2048, 2048],
      [2048, 2048],
      [2048, 2048],
    ]
    const limit =
      "a model may have at most 16,777,216, four 2048 x 2048 textures' worth (about 90 MB of the graphics card's memory). " +
      "Use fewer textures or smaller ones (in Blender's Image Editor, Image > Resize, then Image > Save) and export again, " +
      'or write a colour such as material: grey'

    it('passes four 2048 x 2048 textures, and refuses one pixel more, naming the file, the total and the limit', () => {
      expect(MAX_TEXTURE_TOTAL_PIXELS).toBe(16_777_216)
      expect(own(photos(full()))).toBeNull()
      const over = photos([...full(), [1, 1]])
      expect(modelBytesProblem(over, 'glb', 'file', 'models/photos.glb')).toBe(
        `the model 'models/photos.glb' has 16,777,217 pixels of textures in all (5 images); ${limit}`,
      )
      // without a path, as a test may ask
      expect(own(over)).toBe(`the model has 16,777,217 pixels of textures in all (5 images); ${limit}`)
      // with a colour, the textures are left out, however many
      expect(modelBytesProblem(over, 'glb', 'preset')).toBeNull()
      // smaller images add up the same way
      expect(own(photos([[2048, 2048], [2048, 2048], [2048, 2048], [2048, 2047], [2048, 1]]))).toBeNull()
      expect(own(photos([[2048, 2048], [2048, 2048], [2048, 2048], [2048, 2048], [16, 16], [8, 8]]))).toMatch(
        /^the model has 16,777,536 pixels of textures in all \(6 images\);/,
      )
    })

    it('counts an image once, however many textures and materials use it', () => {
      // a fifth material showing the first image again, through a texture of its own and through the first one
      const again = photos(full(), (json) => {
        json.textures.push({ source: 0 })
        json.materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: 4 }, metallicFactor: 0 }, normalTexture: { index: 0 } })
        json.meshes[0].primitives.push({ ...json.meshes[0].primitives[0], material: 4 })
      })
      expect(own(again)).toBeNull()
    })

    it("doesn't count an image no material's texture uses, which is never loaded", () => {
      // a fifth image with a texture no material uses: its material shows the first image instead
      const unused = photos([...full(), [2048, 2048]], (json) => (json.materials[4].pbrMetallicRoughness.baseColorTexture.index = 0))
      expect(own(unused)).toBeNull()
      // and with no texture at all
      const bare = photos([...full(), [2048, 2048]], (json) => {
        json.textures.pop()
        json.materials[4].pbrMetallicRoughness.baseColorTexture.index = 0
      })
      expect(own(bare)).toBeNull()
      // a material using it counts it, in an extension's texture too
      expect(own(photos([...full(), [2048, 2048]]))).toMatch(/^the model has 20,971,520 pixels of textures in all \(5 images\);/)
      const coat = photos([...full(), [2048, 2048]], (json) => {
        json.materials[4].pbrMetallicRoughness.baseColorTexture.index = 0
        json.materials[4].extensions = { KHR_materials_clearcoat: { clearcoatTexture: { index: 4 } } }
      })
      expect(own(coat)).toMatch(/^the model has 20,971,520 pixels of textures in all/)
    })
  })

  it('reads a JPEG labelled image/jpg, as some programs write it, as a JPEG', () => {
    expect(own(textureBox({ bytes: jpeg(16, 16), mimeType: 'image/jpg' }))).toBeNull()
    expect(own(textureBox({ name: 'label', bytes: jpeg(4096, 16), mimeType: 'image/jpg' }))).toMatch(/^the model's image 'label' is 4096 x 16 pixels/)
    expect(own(textureBox({ name: 'label', mimeType: 'image/jpg' }))).toBe("the model's image 'label' isn't the JPEG the file says it is: export it again")
  })

  it("refuses a JPEG whose frame header libjpeg reads elsewhere: a larger image can't hide behind FF 00", () => {
    expect(own(textureBox({ name: 'label', bytes: hiddenJpeg().buffer as ArrayBuffer, mimeType: 'image/jpeg' }))).toBe(
      "the model's image 'label' isn't the JPEG the file says it is: export it again",
    )
  })

  it('refuses an image that is not a PNG or JPEG, or not the one it says', () => {
    const only =
      "a lecture shows PNG and JPEG textures only. Export the textures as PNG or JPEG (in Blender's glTF export, under Data > Material, " +
      'Images: JPEG Format, with Create WebP off)'
    expect(own(textureBox({ name: 'label', mimeType: 'image/webp' }))).toBe(`the model's image 'label' is 'image/webp': ${only}`)
    expect(own(textureBox({ name: 'label', mimeType: 'image/ktx2' }))).toBe(`the model's image 'label' is 'image/ktx2': ${only}`)
    expect(own(textureBox({ name: 'label' }, (json) => delete json.images[0].mimeType))).toBe(`the model's image 'label' is of no type it says: ${only}`)
    expect(own(textureBox({ name: 'label', mimeType: 'image/jpeg' }))).toBe("the model's image 'label' isn't the JPEG the file says it is: export it again")
    expect(own(textureBox({ name: 'label', bytes: jpeg(8, 8) }))).toBe("the model's image 'label' isn't the PNG the file says it is: export it again")
    expect(own(textureBox({ name: 'label', bytes: new Uint8Array(64).buffer }))).toMatch(/isn't the PNG the file says it is/)
  })

  it("refuses a texture kept as something else, named, whether extensionsUsed lists it or the texture only", () => {
    for (const [name, kind] of [
      ['KHR_texture_basisu', 'KTX2'],
      ['EXT_texture_webp', 'WebP'],
      ['EXT_texture_avif', 'AVIF'],
    ]) {
      const message =
        `the model's textures are ${kind} (${name}), which a lecture can't show: export the textures as PNG or JPEG ` +
        "(in Blender's glTF export, under Data > Material, Images: JPEG Format, with Create WebP off)"
      expect(own(textureBox({}, glbEdits.extension(name)))).toBe(message)
      expect(own(textureBox({}, (json) => (json.textures[0].extensions = { [name]: { source: 0 } })))).toBe(message)
    }
  })

  it('refuses an image outside the file, and a texture or material pointing at nothing', () => {
    expect(own(textureBox({ name: 'label' }, (json) => (json.images[0] = { name: 'label', uri: 'label.png' })))).toBe(
      "the model keeps its image 'label' outside the .glb (in another file or a data: address): export it as one self-contained .glb",
    )
    expect(own(textureBox({}, (json) => (json.images[0].uri = 'data:image/png;base64,AAAA')))).toMatch(/keeps its image 'label' outside the \.glb/)
    expect(own(textureBox({}, (json) => (json.textures[0].source = 3)))).toBe("the model's texture number 1 has no image in the file: export it again")
    expect(own(textureBox({}, (json) => (json.materials[0].pbrMetallicRoughness.baseColorTexture.index = 2)))).toBe(
      "the model's material 'label' uses a texture the file doesn't have: export it again",
    )
    // an extension's texture too
    expect(own(textureBox({}, (json) => (json.materials[0].extensions = { KHR_materials_clearcoat: { clearcoatTexture: { index: 9 } } })))).toMatch(
      /material 'label' uses a texture the file doesn't have/,
    )
    // an image's bytes past the end of the file's data
    expect(own(textureBox({}, (json) => (json.bufferViews[json.images[0].bufferView].byteLength += 1000)))).toBe(notGlb)
    expect(own(textureBox({}, (json) => (json.images[0].bufferView = 99)))).toBe(notGlb)
  })

  it('refuses a see-through material, which the stage draws wrong or not at all, and says how to cut a surround out instead', () => {
    const opaque =
      "make it opaque in the program that made it (in Blender, the Principled BSDF's Alpha at 1, with nothing linked to it), " +
      'or write a colour such as material: grey'
    expect(own(coloured({ name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { metallicFactor: 0 } }))).toBe(
      "the model's material 'glass' is see-through (blended, alpha mode BLEND), which the stage draws wrong or not at all: " +
        "make it opaque in the program that made it (in Blender, the Principled BSDF's Alpha at 1, with nothing linked to it), " +
        "or for a transparent surround, such as a sticker's, use alpha clip (in Blender, a Math node set to Round between " +
        "the texture's Alpha and the Principled BSDF's Alpha); or write a colour such as material: grey",
    )
    for (const name of ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_dispersion', 'KHR_materials_diffuse_transmission']) {
      expect(own(coloured({ name: 'glass', pbrMetallicRoughness: { metallicFactor: 0 }, extensions: { [name]: {} } }))).toBe(
        `the model's material 'glass' is see-through (${name}), which the stage can't draw: ${opaque}`,
      )
    }
    expect(own(coloured({ name: 'paint', alphaMode: 'OPAQUE', pbrMetallicRoughness: { metallicFactor: 0 } }))).toBeNull()
  })

  it('passes a cut-out material (alpha mode MASK, Blender\'s alpha clip), with its cutoff or without (the author, 2026-11-26)', () => {
    const sticker = (material: Record<string, unknown>) => textureBox({}, (json) => Object.assign(json.materials[0], material))
    expect(own(sticker({ alphaMode: 'MASK' }))).toBeNull()
    expect(own(sticker({ alphaMode: 'MASK', alphaCutoff: 0.3 }))).toBeNull()
    expect(own(sticker({ alphaMode: 'MASK', alphaCutoff: 0 }))).toBeNull()
    expect(own(coloured({ name: 'leaf', alphaMode: 'MASK', pbrMetallicRoughness: { metallicFactor: 0 } }))).toBeNull()
    // a cutoff three would take for a number, or one glTF doesn't allow, is a broken file
    for (const cutoff of ['0.5', -0.1, null, [0.5]]) {
      expect(own(sticker({ alphaMode: 'MASK', alphaCutoff: cutoff })), JSON.stringify(cutoff)).toBe(notGlb)
    }
    // the cutoff only counts with MASK, as GLTFLoader reads it
    expect(own(sticker({ alphaCutoff: '0.5' }))).toBeNull()
  })

  it('refuses a material more metallic than the metal preset without a metallic texture: the stage has no reflections', () => {
    expect(MAX_FILE_METALNESS).toBe(0.6)
    const advice =
      'the stage has no reflections for a metal to show, so it would look near black. Set its metallic to at most 0.6 in the program that made it, ' +
      'or write a colour such as material: metal'
    expect(own(coloured({ name: 'steel', pbrMetallicRoughness: { metallicFactor: 0.9 } }))).toBe(
      `the model's material 'steel' is metallic (metallicFactor 0.9): ${advice}`,
    )
    // glTF's own metallicFactor is 1, and Blender leaves it out then
    expect(own(coloured({ name: 'plain' }))).toBe(
      `the model's material 'plain' is metallic (metallicFactor left out, which glTF reads as 1; Blender leaves it out at Metallic 1): ${advice}`,
    )
    expect(own(coloured({ pbrMetallicRoughness: {} }))).toMatch(/^the model's material number 1 is metallic \(metallicFactor left out, which glTF reads as 1;/)
    // any other value three would take as a number: GLTFLoader hands it on, and three reads '1' as 1
    for (const value of ['1', [1], true, null]) {
      expect(own(coloured({ pbrMetallicRoughness: { metallicFactor: value } })), JSON.stringify(value)).toBe(notGlb)
    }
    // as metallic as the preset, unlit, or with a texture saying how metallic each point is (which isn't read here)
    expect(own(coloured({ pbrMetallicRoughness: { metallicFactor: 0.6 } }))).toBeNull()
    expect(own(coloured({ extensions: { KHR_materials_unlit: {} } }))).toBeNull()
    expect(own(textureBox({}, (json) => (json.materials[0].pbrMetallicRoughness = { metallicRoughnessTexture: { index: 0 } })))).toBeNull()
  })

  it('passes a mesh without a material, which is shown grey, as Blender shows it (the author, 2026-11-26)', () => {
    expect(own(glb({ meshes: [{ name: 'tray' }] }))).toBeNull()
    // next to a textured one, with no texture coordinates of its own
    expect(own(textureBox({}, (json) => json.meshes[0].primitives.push({ attributes: { POSITION: 0 } })))).toBeNull()
    // lines and points are left out, material or not
    expect(own(glb({ meshes: [{ material: 0 }, { mode: 1 }, { mode: 0 }], materials: [{ pbrMetallicRoughness: { metallicFactor: 0 } }] }))).toBeNull()
    expect(own(coloured({ pbrMetallicRoughness: { metallicFactor: 0 } }, { material: 4 }))).toBe(notGlb)
  })

  it('refuses a textured mesh without the texture coordinates its textures use', () => {
    const unwrap = 'unwrap it in the program that made it, or write a colour such as material: grey'
    expect(own(textureBox({}, (json) => delete json.meshes[0].primitives[0].attributes.TEXCOORD_0))).toBe(
      `the model's mesh 'box' has a texture but not the texture coordinates it uses (TEXCOORD_0, a UV map): ${unwrap}`,
    )
    expect(own(textureBox({}, (json) => (json.materials[0].normalTexture = { index: 0, texCoord: 1 })))).toMatch(/\(TEXCOORD_1, a UV map\)/)
    // KHR_texture_transform may name the coordinates in place of the texture
    const transformed = (texCoord: number) =>
      textureBox({}, (json) => {
        json.extensionsUsed = ['KHR_texture_transform']
        json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: { scale: [2, 2], texCoord } }
      })
    expect(own(transformed(1))).toMatch(/\(TEXCOORD_1, a UV map\)/)
    expect(own(transformed(0))).toBeNull()
    // but only when extensionsUsed lists it: GLTFLoader reads the transform only then
    const unlisted = textureBox({}, (json) => {
      json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: { texCoord: 1 } }
    })
    expect(own(unlisted)).toBeNull()
  })

  it("refuses a required extension GLTFLoader doesn't read into the file's look, and allows those it does", () => {
    for (const name of ['KHR_materials_clearcoat', 'KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_texture_transform', 'EXT_materials_bump']) {
      expect(own(textureBox({}, glbEdits.extension(name))), name).toBeNull()
    }
    expect(own(textureBox({}, glbEdits.extension('KHR_materials_pbrSpecularGlossiness')))).toBe(
      "the model needs the glTF extension 'KHR_materials_pbrSpecularGlossiness', which lysark doesn't read: export it without it",
    )
    // with a preset, any material extension is replaced
    expect(modelBytesProblem(textureBox({}, glbEdits.extension('KHR_materials_pbrSpecularGlossiness')), 'glb', 'preset')).toBeNull()
  })
})

describe('pngSize and jpegSize: an image size from its header', () => {
  const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer)

  it("reads a PNG's IHDR", () => {
    expect(pngSize(bytes(png(80, 40)))).toEqual({ width: 80, height: 40 })
    expect(pngSize(bytes(jpeg(8, 8)))).toBeUndefined()
    expect(pngSize(bytes(png(80, 40)).subarray(0, 23))).toBeUndefined()
  })

  it("reads a JPEG's frame header past other segments and fill bytes", () => {
    expect(jpegSize(bytes(jpeg(640, 480)))).toEqual({ width: 640, height: 480 })
    expect(jpegSize(bytes(jpeg(33, 17, { frame: 0xc2 })))).toEqual({ width: 33, height: 17 })
    // fill bytes before a marker
    const plain = bytes(jpeg(16, 8))
    const filled = new Uint8Array(plain.length + 2)
    filled.set(plain.subarray(0, 2))
    filled.set([0xff, 0xff], 2)
    filled.set(plain.subarray(2), 4)
    expect(jpegSize(filled)).toEqual({ width: 16, height: 8 })
    expect(jpegSize(bytes(png(8, 8)))).toBeUndefined()
    // the image's data before any frame header
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeUndefined()
    expect(jpegSize(plain.subarray(0, 30))).toBeUndefined()
  })

  it('reads the markers as libjpeg, the browsers\' decoder, does, or refuses the file', () => {
    // FF 00 isn't a marker: libjpeg skips it and the bytes up to the next FF, and reads a
    // 4096-pixel frame header that a length after FF 00 would skip, to a 16-pixel one
    expect(jpegSize(hiddenJpeg())).toBeUndefined()
    // a reserved marker (RESn, JPG, DHP, EXP, JPGn), which libjpeg refuses, before the frame header
    const plain = bytes(jpeg(16, 8))
    for (const marker of [0x02, 0x4f, 0xbf, 0xc8, 0xde, 0xdf, 0xf0, 0xfd]) {
      const reserved = new Uint8Array(plain.length + 4)
      reserved.set(plain.subarray(0, 2))
      reserved.set([0xff, marker, 0, 2], 2)
      reserved.set(plain.subarray(2), 6)
      expect(jpegSize(reserved), marker.toString(16)).toBeUndefined()
    }
    // the markers libjpeg reads on past: application data and comments (0xe0 to 0xef, 0xfe), and a restart interval
    for (const marker of [0xe1, 0xef, 0xfe, 0xdd]) {
      const read = new Uint8Array(plain.length + 6)
      read.set(plain.subarray(0, 2))
      read.set([0xff, marker, 0, 4, 0, 0], 2)
      read.set(plain.subarray(2), 8)
      expect(jpegSize(read), marker.toString(16)).toEqual({ width: 16, height: 8 })
    }
  })
})

/**
 * A JPEG's header as a crafted file has it (step 9's review): after the start
 * of the image, FF 00 and two bytes, which read as a marker with a length
 * would skip to a 16 x 16 frame header inside an APP1 segment; libjpeg skips
 * FF 00 and the bytes up to the next FF, and reads the 4096 x 4096 frame
 * header before the APP1. The crafted file, with tables and image data after
 * this, decodes at 4096 x 4096 in Chromium and Firefox.
 */
function hiddenJpeg(): Uint8Array {
  const frame = (size: number) => [0xff, 0xc0, 0, 11, 8, size >> 8, size & 0xff, size >> 8, size & 0xff, 1, 1, 0x11, 0]
  // 0x13, read as a length: its own 2 bytes, the large frame header's 13 and the APP1's first 4
  return new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x13, ...frame(4096), 0xff, 0xe1, 0x00, 15, ...frame(16), 0xff, 0xd9])
}

describe('modelExtentProblem: the size of the model (B11-B12)', () => {
  it('allows 1 mm to 10 m, read in the unit', () => {
    expect(modelExtentProblem(10, 'm')).toBeNull()
    expect(modelExtentProblem(0.3, 'm')).toBeNull()
    expect(modelExtentProblem(300, 'mm')).toBeNull()
    expect(modelExtentProblem(1, 'mm')).toBeNull()
    expect(modelExtentProblem(1000, 'cm')).toBeNull()
  })

  it('says a model too large is likely in millimetres (B11)', () => {
    expect(modelExtentProblem(412.3, 'm')).toBe('the model is 412 m across, read in m. Is the file in millimetres? Write unit: mm')
    expect(modelExtentProblem(10.06, 'm')).toBe('the model is 10.1 m across, read in m. Is the file in millimetres? Write unit: mm')
    expect(modelExtentProblem(15000, 'mm')).toBe('the model is 15 m across even read in mm: check unit')
    expect(modelExtentProblem(2000, 'cm')).toBe('the model is 20 m across even read in cm: check unit')
  })

  it('says a model too small is likely in metres (B12)', () => {
    expect(modelExtentProblem(0.4, 'mm')).toBe('the model is 0.4 mm across, read in mm. Is the file in metres? Leave out unit')
    expect(modelExtentProblem(0.05, 'cm')).toBe('the model is 0.5 mm across, read in cm. Is the file in metres? Leave out unit')
    expect(modelExtentProblem(0.0004, 'm')).toBe('the model is 0.4 mm across, read in m: a model is at least 1 mm across. Export it again at its real size')
  })

  it('refuses a size that is not a number', () => {
    expect(modelExtentProblem(NaN, 'm')).toBe("the model's points aren't all numbers: export it again")
    expect(modelExtentProblem(Infinity, 'mm')).toBe("the model's points aren't all numbers: export it again")
  })
})
