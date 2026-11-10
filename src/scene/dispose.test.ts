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
})
