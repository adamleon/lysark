import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../engine/object-types'
import { disposeSceneGraph } from './dispose'
import { binaryStl, glb, glbEdits } from './model-test-files.js'
import { parseModel } from './models'
import { buildObject } from './objects'

const color = () => '#808080'
const model = (name: string, src: string): SceneObject => ({
  name,
  shape: 'model',
  size: [],
  at: [0, 0, 0],
  rotate: [0, 0, 0],
  model: { src, unit: 'm', up: 'y' },
})

describe('disposeSceneGraph', () => {
  it("frees every geometry and material of a model object, so a model's GPU memory goes with its scene", async () => {
    const root = new THREE.Group()
    // a GLB with what the loader leaves out (lines, points, a light, a camera), and an STL
    const tray = await parseModel(
      glb({ meshes: [{}, { translation: [2, 0, 0], normals: false }, { mode: 1 }, { mode: 0 }], edits: [glbEdits.light(), glbEdits.camera()] }),
      'glb',
    )
    root.add(buildObject(model('tray', 'models/tray.glb'), color, tray))
    root.add(buildObject(model('bracket', 'models/bracket.stl'), color, await parseModel(binaryStl(), 'stl')))

    const freed = new Set<THREE.EventDispatcher<{ dispose: object }>>()
    const resources = new Set<THREE.BufferGeometry | THREE.Material>()
    root.traverse((node) => {
      // dispose.ts frees only meshes (and line segments): nothing else may be left under a model
      expect(node instanceof THREE.Mesh || node.type === 'Group').toBe(true)
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      for (const resource of [mesh.geometry, mesh.material as THREE.Material]) {
        resources.add(resource)
        resource.addEventListener('dispose', () => freed.add(resource))
      }
    })
    // three meshes, each its own geometry, and one material per object
    expect(resources.size).toBe(3 + 2)

    disposeSceneGraph(root)
    expect(freed.size).toBe(resources.size)
  })

  /** counts each resource's 'dispose' events */
  function disposals(...resources: Array<THREE.EventDispatcher<{ dispose: object }>>): Map<unknown, number> {
    const count = new Map<unknown, number>(resources.map((resource) => [resource, 0]))
    for (const resource of resources) resource.addEventListener('dispose', () => count.set(resource, count.get(resource)! + 1))
    return count
  }

  it('frees every texture a material holds, by whatever name the material type gives it', () => {
    const texture = () => new THREE.DataTexture(new Uint8Array(4), 1, 1)
    const names = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'envMap']
    // MeshPhysicalMaterial's own, as GLTFLoader gives them for a file's KHR_materials_* extensions
    const physical = ['clearcoatMap', 'clearcoatNormalMap', 'sheenColorMap', 'iridescenceMap', 'specularColorMap', 'anisotropyMap']
    const standard = new THREE.MeshStandardMaterial()
    const more = new THREE.MeshPhysicalMaterial()
    const textures: THREE.Texture[] = []
    for (const [material, keys] of [
      [standard, names],
      [more, physical],
    ] as const) {
      for (const key of keys) {
        const t = texture()
        ;(material as unknown as Record<string, THREE.Texture>)[key] = t
        textures.push(t)
      }
    }
    // a ShaderMaterial's textures are its uniforms' values
    const uniform = texture()
    const shader = new THREE.ShaderMaterial({ uniforms: { pattern: { value: uniform }, scale: { value: 2 } } })
    textures.push(uniform)
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    root.add(new THREE.Mesh(geometry, standard), new THREE.Mesh(geometry, [more, shader]))
    const count = disposals(...textures)

    disposeSceneGraph(root)
    expect([...count.values()]).toEqual(textures.map(() => 1))
    // the CPU side stays, so the scene can come back: three uploads the image again on its next render
    expect((standard.map as THREE.DataTexture).image.data).toBeInstanceOf(Uint8Array)
  })

  it('frees a texture, material or geometry that several share once, and each other one', () => {
    const shared = new THREE.DataTexture(new Uint8Array(4), 1, 1)
    const own = new THREE.DataTexture(new Uint8Array(4), 1, 1)
    // two materials with one texture, as GLTFLoader gives a file whose materials share an image
    const a = new THREE.MeshStandardMaterial({ map: shared })
    const b = new THREE.MeshStandardMaterial({ map: shared, normalMap: own, emissiveMap: shared })
    const geometry = new THREE.BoxGeometry()
    const root = new THREE.Group()
    root.add(new THREE.Mesh(geometry, a), new THREE.Mesh(geometry, a), new THREE.Mesh(geometry, b))
    const count = disposals(shared, own, a, b, geometry)

    disposeSceneGraph(root)
    expect([...count.values()]).toEqual([1, 1, 1, 1, 1])
  })

  it('frees lines and points as it frees meshes, and shadow maps', () => {
    const lineGeometry = new THREE.BufferGeometry()
    const lineMaterial = new THREE.LineBasicMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1) })
    const pointsGeometry = new THREE.BufferGeometry()
    const pointsMaterial = new THREE.PointsMaterial()
    const light = new THREE.DirectionalLight()
    light.castShadow = true
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1)
    const shadow = light.shadow.map
    const root = new THREE.Group()
    root.add(new THREE.Line(lineGeometry, lineMaterial), new THREE.LineLoop(lineGeometry, lineMaterial), new THREE.Points(pointsGeometry, pointsMaterial), light)
    const count = disposals(lineGeometry, lineMaterial, lineMaterial.map!, pointsGeometry, pointsMaterial, shadow)

    disposeSceneGraph(root)
    expect([...count.values()]).toEqual([1, 1, 1, 1, 1, 1])
    expect(light.shadow.map).toBeNull()
  })
})
