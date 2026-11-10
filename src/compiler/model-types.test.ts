import { describe, expect, it } from 'vitest'
import { binaryStl, box, glb, glbChunk, glbEdits, lfsPointer, textStl, withExtraByte, withGlbTail } from '../scene/model-test-files.js'
import {
  MIN_MODEL_METRES,
  MODEL_MAX_BYTES,
  MODEL_UNITS,
  modelBytesProblem,
  modelExtentProblem,
  modelFormat,
  modelPathProblem,
  modelSizeProblem,
  modelWhere,
} from './model-types'

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
    expect(modelSizeProblem(MODEL_MAX_BYTES)).toBeNull()
    expect(modelSizeProblem(7_300_000)).toBe(`the model is 7.3 MB; ${tooLarge}`)
    expect(modelSizeProblem(5_040_000)).toBe(`the model is 5.04 MB; ${tooLarge}`)
    expect(modelSizeProblem(MODEL_MAX_BYTES + 1)).toBe(`the model is 5.000001 MB; ${tooLarge}`)
    expect(modelBytesProblem(new ArrayBuffer(MODEL_MAX_BYTES + 1), 'stl')).toBe(`the model is 5.000001 MB; ${tooLarge}`)
    expect(modelBytesProblem(new ArrayBuffer(MODEL_MAX_BYTES + 1), 'glb')).toMatch(/^the model is 5\.000001 MB/)
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

  it('refuses textures (B5)', () => {
    const message =
      'the model has textures, which come in a later step. Its colour comes from material: anyway, so export it without materials or textures (or as STL)'
    expect(modelBytesProblem(glb({ edits: [glbEdits.image()] }), 'glb')).toBe(message)
    expect(
      modelBytesProblem(
        glb({
          edits: [
            (json) => {
              json.textures = [{}]
            },
          ],
        }),
        'glb',
      ),
    ).toBe(message)
    for (const name of ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']) {
      expect(modelBytesProblem(glb({ edits: [glbEdits.extension(name, false)] }), 'glb')).toBe(message)
    }
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
