import * as THREE from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneObject } from '../engine/object-types'
import { binaryStl, cylinder, glb, glbEdits, textStl, UNIT_CUBE, type GlbEdit } from './model-test-files.js'
import { decodeBase64, modelLoader, parseModel } from './models'

/** the file as base64, as the student file and the editor host give it */
function base64(buffer: ArrayBuffer): string {
  let text = ''
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte)
  return btoa(text)
}

/** every node under the model, by name */
function named(model: THREE.Object3D): Record<string, THREE.Object3D> {
  const found: Record<string, THREE.Object3D> = {}
  model.traverse((node) => {
    if (node.name) found[node.name] = node
  })
  return found
}

function meshes(model: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  model.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh)
  })
  return out
}

const boxOf = (model: THREE.Object3D) => new THREE.Box3().setFromObject(model, true)
const near = (a: THREE.Vector3, b: [number, number, number]) => expect(a.distanceTo(new THREE.Vector3(...b))).toBeLessThan(1e-6)

/** the model object `name` showing `src` */
const modelObject = (name: string, src: string): SceneObject => ({
  name,
  shape: 'model',
  size: [],
  at: [0, 0, 0],
  rotate: [0, 0, 0],
  model: { src, unit: 'm', up: 'y' },
})

describe('models', () => {
  afterEach(() => vi.restoreAllMocks())

  it('decodes base64 into an ArrayBuffer exactly as long as the file', () => {
    const file = binaryStl()
    const bytes = decodeBase64(base64(file))
    expect(bytes).toBeInstanceOf(ArrayBuffer)
    expect(bytes.byteLength).toBe(file.byteLength)
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(file))
  })

  it('reads binary and text STL as one mesh, with creased normals and no colours', async () => {
    // 'COLOR=' in a binary STL's header gives STLLoader's vertex colours, which the preset replaces
    for (const file of [binaryStl(UNIT_CUBE, { header: 'COLOR=AAAA from a CAD program' }), textStl()]) {
      const model = await parseModel(file, 'stl')
      const [mesh, ...more] = meshes(model)
      expect(more).toHaveLength(0)
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['normal', 'position'])
      expect(mesh.geometry.attributes.position.count).toBe(36)
      expect(boxOf(model).min.toArray()).toEqual([-0.5, 0, -0.5])
      expect(boxOf(model).max.toArray()).toEqual([0.5, 1, 0.5])
      // a cube's faces meet at 90 degrees, more than the crease: each corner keeps its face's normal
      const normal = mesh.geometry.attributes.normal
      for (let i = 0; i < normal.count; i++) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i)
        expect(n.length()).toBeCloseTo(1, 6)
        expect(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))).toBeCloseTo(1, 6)
      }
    }
  })

  it('creases a small part drawn in metres as it does one drawn in millimetres', async () => {
    // 20 mm across: toCreasedNormals alone counts corners within a centimetre as one in a metre file
    const normals = async (scale: number) => {
      const triangles = cylinder({ radius: 10 * scale, height: 30 * scale, segments: 32 })
      return meshes(await parseModel(binaryStl(triangles), 'stl'))[0].geometry.attributes.normal
    }
    const [millimetres, metres] = [await normals(1), await normals(0.001)]
    const angle = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, b: typeof a, i: number) =>
      new THREE.Vector3().fromBufferAttribute(a, i).angleTo(new THREE.Vector3().fromBufferAttribute(b, i))
    let worst = 0
    for (let i = 0; i < millimetres.count; i++) worst = Math.max(worst, angle(millimetres, metres, i))
    expect(worst).toBeLessThan(1e-3)
    // without the scaling, the metre file's normals are out by degrees
    const plain = new THREE.BufferGeometry()
    plain.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cylinder({ radius: 0.01, height: 0.03, segments: 32 }).flat(2)), 3))
    const smeared = toCreasedNormals(plain, THREE.MathUtils.degToRad(40)).attributes.normal
    let off = 0
    for (let i = 0; i < millimetres.count; i++) off = Math.max(off, angle(millimetres, smeared, i))
    expect(off).toBeGreaterThan(THREE.MathUtils.degToRad(2))
  })

  it("reads a GLB's meshes with their node transforms", async () => {
    const model = await parseModel(
      glb({ meshes: [{ name: 'plate', translation: [1, 0, 0] }, { name: 'peg', scale: [2, 2, 2] }], root: { translation: [0, 1, 0] } }),
      'glb',
    )
    expect(meshes(model).map((mesh) => mesh.name)).toEqual(['plate', 'peg'])
    near(boxOf(model).min, [-1, 1, -1])
    near(boxOf(model).max, [1.5, 3, 1])
  })

  it("leaves out a GLB's lights, cameras, lines and points, and keeps what hangs on them", async () => {
    const model = await parseModel(
      glb({ meshes: [{ name: 'plate' }, { name: 'edges', mode: 1 }, { name: 'dots', mode: 0 }], edits: [glbEdits.light(), glbEdits.camera()] }),
      'glb',
    )
    model.traverse((node) => {
      const { isLight, isCamera, isLine, isPoints } = node as unknown as Record<string, boolean | undefined>
      expect(isLight || isCamera || isLine || isPoints).toBeFalsy()
    })
    expect(meshes(model).map((mesh) => mesh.name)).toEqual(['plate'])

    // GLTFLoader makes a node with only a line or a camera that thing itself, with the file's children on it
    const under = (parent: number, child: number): GlbEdit => (json) => {
      json.nodes[parent].children = [...(json.nodes[parent].children ?? []), child]
      json.scenes[0].nodes = json.scenes[0].nodes.filter((node: number) => node !== child)
    }
    const nested = await parseModel(
      glb({
        meshes: [{ name: 'plate', translation: [0, 0.5, 0] }, { name: 'edges', mode: 1, translation: [1, 0, 0] }, { name: 'peg' }],
        // the camera is node 3, at [0, 0, 3]
        edits: [glbEdits.camera(), under(1, 0), under(3, 2)],
      }),
      'glb',
    )
    const found = named(nested)
    expect(meshes(nested).map((mesh) => mesh.name).sort()).toEqual(['peg', 'plate'])
    expect(found.edges.type).toBe('Group')
    nested.updateMatrixWorld(true)
    near(boxOf(found.plate).min, [0.5, 0.5, -0.5])
    near(boxOf(found.peg).min, [-0.5, 0, 2.5])
  })

  it('gives a GLB mesh without normals creased ones', async () => {
    const model = await parseModel(glb({ meshes: [{ name: 'bare', normals: false }] }), 'glb')
    const normal = meshes(model)[0].geometry.attributes.normal
    expect(normal.count).toBe(36)
    for (let i = 0; i < normal.count; i++) {
      expect(Math.max(...new THREE.Vector3().fromBufferAttribute(normal, i).toArray().map(Math.abs))).toBeCloseTo(1, 6)
    }
  })

  it('rejects a file its loader can not read', async () => {
    const broken = new Uint8Array(glb())
    broken[20] = '<'.charCodeAt(0) // the JSON chunk's first byte: GLTFLoader's JSON.parse throws
    await expect(parseModel(broken.buffer, 'glb')).rejects.toThrow()
  })

  // the checks refuse all of these first (model-types.ts); here they are parsed as if one slipped past
  it('rejects a GLB that asks for another file, and never starts a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no requests in the tests'))
    const asks = async (file: ArrayBuffer, url: string) =>
      expect(parseModel(file, 'glb')).rejects.toThrow(`it asks for another file, '${url}': export it as one self-contained .glb`)
    await asks(glb({ edits: [glbEdits.bufferUri()] }), 'data:application/octet-stream;base64,AAAA')
    await asks(glb({ edits: [glbEdits.twoBuffers(), (json) => (json.bufferViews[0].buffer = 1)] }), 'more.bin')
    // as '0', the GLB's own buffer is asked for at the address ''
    await asks(glb({ edits: [(json) => (json.bufferViews[0].buffer = '0')] }), '')
    // a long address is cut short
    const long = `https://example.invalid/${'x'.repeat(100)}.bin`
    await asks(glb({ edits: [(json) => (json.buffers[0].uri = long)] }), `${long.slice(0, 59)}…`)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects a GLB whose texture asks for a file, though GLTFLoader only logs a texture it can't load", async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no requests in the tests'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // GLTFLoader reads a browser's `self` for a texture
    vi.stubGlobal('self', globalThis)
    try {
      const textured: GlbEdit = (json) => {
        json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }]
        json.meshes[0].primitives[0].material = 0
      }
      await expect(parseModel(glb({ edits: [glbEdits.image(), textured] }), 'glb')).rejects.toThrow(
        "it asks for another file, 'texture.png': export it as one self-contained .glb",
      )
      expect(error.mock.calls[0]?.[0]).toMatch(/^THREE\.GLTFLoader: Couldn't load texture/)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("loads each model object's model, and never rejects", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = new Uint8Array(glb())
    broken[20] = '<'.charCodeAt(0)
    const loader = modelLoader({
      'models/bracket.stl': base64(binaryStl()),
      'models/tray.glb': base64(glb({ meshes: [{}, { translation: [2, 0, 0] }] })),
      'models/broken.glb': base64(broken.buffer),
      'models/garbled.stl': 'not base64!',
    })
    const models = await loader.load([
      modelObject('bracket', 'models/bracket.stl'),
      modelObject('copy', 'models/bracket.stl'),
      modelObject('tray', 'models/tray.glb'),
      { name: 'table', shape: 'box', size: [1, 1, 1], at: [0, 0, 0], rotate: [0, 0, 0] },
      // a file the build or the panel refused: they have said why
      modelObject('absent', 'models/absent.stl'),
      modelObject('broken', 'models/broken.glb'),
      modelObject('garbled', 'models/garbled.stl'),
    ])
    expect([...models.keys()]).toEqual(['bracket', 'copy', 'tray'])
    expect(meshes(models.get('tray')!)).toHaveLength(2)
    // each object parses its own: no two share a geometry
    expect(meshes(models.get('copy')!)[0].geometry).not.toBe(meshes(models.get('bracket')!)[0].geometry)
    expect(error).toHaveBeenCalledTimes(2)
    expect(error.mock.calls[0][0]).toMatch(/^object 'broken': the model 'models\/broken\.glb' couldn't be read: \S/)
    expect(error.mock.calls[1][0]).toMatch(/^object 'garbled': the model 'models\/garbled\.stl' couldn't be read: \S/)
  })
})
