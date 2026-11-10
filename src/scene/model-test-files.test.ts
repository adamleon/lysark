import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { binaryStl, box, cylinder, glb, glbEdits, textStl, UNIT_CUBE, type Triangle } from './model-test-files.js'

// The builders are shared by the model tests and the demo's models
// (scripts/make-demo-models.mjs): this checks that three.js reads what they write.

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

  it('writes well-formed files with nothing in them', async () => {
    expect(new STLLoader().parse(binaryStl([])).attributes.position.count).toBe(0)
    const empty = await new GLTFLoader().parseAsync(glb({ meshes: [] }), '')
    expect(empty.scene.children).toHaveLength(0)
  })
})
