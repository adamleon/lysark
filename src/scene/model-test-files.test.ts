import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { binaryStl, box, cylinder, faceNormal, glb, glbEdits, jpeg, overLimitStl, plate, png, textStl, UNIT_CUBE, type Triangle } from './model-test-files.js'

// The builders are shared by the model tests and the demo's models
// (scripts/make-demo-models.mjs): this checks that three.js reads what they write.

/** zlib data read back, with the web's own reader (as browsers and Node have it) */
async function inflated(data: Uint8Array): Promise<number[]> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate'))
  return [...new Uint8Array(await new Response(stream).arrayBuffer())]
}

/** CRC-32 bit by bit, as PNG defines it */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

/** the GLB with its materials' textures taken out, which GLTFLoader can read in Node, without an <img> */
function withoutImages(file: ArrayBuffer): ArrayBuffer {
  const view = new DataView(file)
  const length = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file, 20, length)))
  delete json.materials[0].pbrMetallicRoughness.baseColorTexture
  const text = new TextEncoder().encode(JSON.stringify(json).padEnd(length, ' '))
  const out = new Uint8Array(file.slice(0))
  out.set(text, 20)
  return out.buffer
}

/** the volume a closed mesh encloses: positive only when every triangle faces out */
function volume(triangles: Triangle[]): number {
  return triangles.reduce((sum, [a, b, c]) => sum + new THREE.Vector3(...a).dot(new THREE.Vector3(...b).cross(new THREE.Vector3(...c))) / 6, 0)
}

describe('model test files', () => {
  it('builds closed boxes and cylinders, facing out', () => {
    expect(volume(box([0, 0, 0], [0.4, 0.2, 0.1]))).toBeCloseTo(0.008, 10)
    for (const axis of ['y', 'z'] as const) {
      const segments = 32
      const prism = (segments / 2) * Math.sin((2 * Math.PI) / segments) * 0.05 ** 2 * 0.3
      expect(volume(cylinder({ radius: 0.05, height: 0.3, base: [0.1, 0.2, 0.3], axis, segments }))).toBeCloseTo(prism, 10)
    }
    const along = new THREE.Box3().setFromPoints(cylinder({ radius: 1, height: 5, axis: 'z' }).flat().map((v) => new THREE.Vector3(...v)))
    expect(along.min.z).toBeCloseTo(0)
    expect(along.max.z).toBeCloseTo(5)
  })

  it('writes binary and text STL that STLLoader reads', () => {
    for (const file of [binaryStl(), textStl()]) {
      const geometry = new STLLoader().parse(file)
      expect(geometry.attributes.position.count).toBe(UNIT_CUBE.length * 3)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.min.toArray()).toEqual([-0.5, 0, -0.5])
      expect(geometry.boundingBox!.max.toArray()).toEqual([0.5, 1, 0.5])
    }
    // the header doesn't start with 'solid', as a binary STL's must not
    expect(new TextDecoder().decode(new Uint8Array(binaryStl()).slice(0, 5))).not.toBe('solid')
  })

  it('builds a plate of as many triangles as asked, facing up, and an STL just over 5 MB of one', () => {
    const triangles = plate({ count: 9, side: 2 })
    expect(triangles).toHaveLength(9)
    expect(plate({ cells: 3 })).toHaveLength(18)
    for (const t of triangles) expect(faceNormal(t)).toEqual([0, 1, 0])
    const corners = new THREE.Box3().setFromPoints(plate({ cells: 3, side: 2 }).flat().map((v) => new THREE.Vector3(...v)))
    expect([corners.min.toArray(), corners.max.toArray()]).toEqual([
      [-1, 0, -1],
      [1, 0, 1],
    ])
    const big = overLimitStl()
    expect(big.byteLength).toBe(5_000_134)
    expect(new STLLoader().parse(big).attributes.position.count).toBe(100_001 * 3)
  })

  it('writes a GLB that GLTFLoader reads, with its meshes, transforms, lights, cameras and lines', async () => {
    const file = glb({
      meshes: [{ name: 'plate', translation: [1, 0, 0] }, { name: 'peg', normals: false, scale: [2, 2, 2] }, { name: 'edges', mode: 1 }],
      root: { translation: [0, 1, 0] },
      edits: [glbEdits.light(), glbEdits.camera()],
    })
    const gltf = await new GLTFLoader().parseAsync(file, '')
    const found: Record<string, THREE.Object3D> = {}
    gltf.scene.traverse((o) => {
      if (o.name) found[o.name] = o
    })
    expect((found.plate as THREE.Mesh).isMesh).toBe(true)
    expect((found.plate as THREE.Mesh).geometry.attributes.normal).toBeDefined()
    expect((found.peg as THREE.Mesh).geometry.attributes.normal).toBeUndefined()
    expect((found.edges as THREE.LineSegments).isLineSegments).toBe(true)
    expect(gltf.cameras).toHaveLength(1)
    let lights = 0
    gltf.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++
    })
    expect(lights).toBe(1)
    gltf.scene.updateMatrixWorld(true)
    const plate = new THREE.Box3().setFromObject(found.plate)
    expect(plate.min.toArray()).toEqual([0.5, 1, -0.5])
    const peg = new THREE.Box3().setFromObject(found.peg)
    expect(peg.max.toArray()).toEqual([1, 3, 1])
  })

  it('writes a PNG whose chunks and pixels are well formed, which zlib reads back', async () => {
    const file = new Uint8Array(png(3, 2, (x, y) => [x * 10, y * 20, 7]))
    const view = new DataView(file.buffer)
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // each chunk: its length, its type, its data, then the CRC-32 of the type and data
    const chunks: Record<string, Uint8Array> = {}
    for (let at = 8; at < file.length; ) {
      const length = view.getUint32(at)
      const type = new TextDecoder().decode(file.subarray(at + 4, at + 8))
      chunks[type] = file.subarray(at + 8, at + 8 + length)
      expect(view.getUint32(at + 8 + length) >>> 0, type).toBe(crc32(file.subarray(at + 4, at + 8 + length)))
      at += 12 + length
    }
    expect(Object.keys(chunks)).toEqual(['IHDR', 'IDAT', 'IEND'])
    // rows: filter 0, then RGB
    expect(await inflated(chunks.IDAT)).toEqual([0, 0, 0, 7, 10, 0, 7, 20, 0, 7, 0, 0, 20, 7, 10, 20, 7, 20, 20, 7])
    // larger than one stored block (the IDAT data: after the signature, IHDR and its own length and type; before its CRC and IEND)
    expect(await inflated(new Uint8Array(png(300, 100)).subarray(41, -16))).toHaveLength(100 * (1 + 900))
    // with alpha: colour type 6, RGBA, opaque where the pixel gives no alpha
    const cut = new Uint8Array(png(2, 1, (x) => (x === 0 ? [1, 2, 3, 0] : [4, 5, 6]), { alpha: true }))
    expect(cut[25]).toBe(6)
    expect(await inflated(cut.subarray(41, -16))).toEqual([0, 1, 2, 3, 0, 4, 5, 6, 255])
  })

  it('writes a GLB with texture coordinates, materials and its images in the binary chunk, which GLTFLoader reads', async () => {
    const label = png(4, 4)
    const file = glb({
      meshes: [{ name: 'box', uvs: true, material: 0 }],
      materials: [{ name: 'label', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
      textures: [{ name: 'label', bytes: label, sampler: { magFilter: 9728 } }],
    })
    // the image as its bytes, at a multiple of 4 in the binary chunk
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file, 20, new DataView(file).getUint32(12, true))))
    const view = json.bufferViews[json.images[0].bufferView]
    expect(view.byteOffset % 4).toBe(0)
    const binary = 20 + new DataView(file).getUint32(12, true) + 8
    expect([...new Uint8Array(file, binary + view.byteOffset, view.byteLength)]).toEqual([...new Uint8Array(label)])
    expect(json.textures).toEqual([{ source: 0, sampler: 0 }])
    // the box's faces show the whole image each, upright: u and v from 0 to 1
    const gltf = await new GLTFLoader().parseAsync(withoutImages(file), '')
    const mesh = gltf.scene.children[0] as THREE.Mesh
    expect((mesh.material as THREE.Material).name).toBe('label')
    const uv = mesh.geometry.attributes.uv
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i))
    expect([Math.min(...us), Math.max(...us)]).toEqual([0, 1])
    // the face towards +z: u runs along x, and v down the image as y goes up
    const position = mesh.geometry.attributes.position
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) !== 0.5 || mesh.geometry.attributes.normal.getZ(i) !== 1) continue
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) + 0.5)
      expect(uv.getY(i)).toBeCloseTo(1 - position.getY(i))
    }
  })

  it('writes a JPEG with its size in its frame header, and its frame type when asked', () => {
    const file = new Uint8Array(jpeg(20, 10, { frame: 0xc2 }))
    expect([...file.subarray(0, 2), ...file.subarray(-2)]).toEqual([0xff, 0xd8, 0xff, 0xd9])
    const frame = file.indexOf(0xc2, 2)
    expect(file[frame - 1]).toBe(0xff)
    expect([...file.subarray(frame + 4, frame + 8)]).toEqual([0, 10, 0, 20])
  })

  it('writes well-formed files with nothing in them', async () => {
    expect(new STLLoader().parse(binaryStl([])).attributes.position.count).toBe(0)
    const empty = await new GLTFLoader().parseAsync(glb({ meshes: [] }), '')
    expect(empty.scene.children).toHaveLength(0)
  })
})
