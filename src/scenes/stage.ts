import * as THREE from 'three'

export { disposeSceneGraph } from '../scene/dispose'

/**
 * Shared stage furniture (lights, grid, shadow catcher) built INTO each
 * scene's root so suspend/dispose covers it (spec §4.1) — the persistent
 * SceneLayer owns none of the world.
 */
export function buildStage(): THREE.Group {
  const stage = new THREE.Group()
  stage.name = 'stage'

  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x30343a, 0.9)
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(2.5, 4, 1.5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 12
  key.shadow.camera.left = -3
  key.shadow.camera.right = 3
  key.shadow.camera.top = 3
  key.shadow.camera.bottom = -3
  key.shadow.bias = -0.0002
  key.shadow.normalBias = 0.02
  stage.add(hemi, key)

  const grid = new THREE.GridHelper(5, 25, 0x3a3640, 0x26232b)
  stage.add(grid)

  // shadow catcher just below the grid to avoid z-fighting
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.001
  ground.receiveShadow = true
  stage.add(ground)

  return stage
}
