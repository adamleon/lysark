import * as THREE from 'three'

export interface ScreenPoint {
  /** pixel x from the left edge */
  x: number
  /** pixel y from the top edge */
  y: number
  /** false when the point is behind the camera — hide the label rather than
      smear it to a mirrored 2D position (perspective divide flips behind) */
  visible: boolean
}

const _world = new THREE.Vector3()
const _view = new THREE.Vector3()

/**
 * Project a world-space point to screen pixels via the camera (spec §4.2).
 *
 * Precondition: the camera's world matrix and matrixWorldInverse must be
 * current for this frame — the caller (AnchorLayer) refreshes them once per
 * frame after render() so every label shares one update.
 */
export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ScreenPoint {
  // view-space z < 0 ⇒ in front of the camera; project() alone can't tell a
  // point in front from its mirror image behind (both land in NDC)
  _view.copy(world).applyMatrix4(camera.matrixWorldInverse)
  const visible = _view.z < 0

  _world.copy(world).project(camera)
  return {
    x: (_world.x * 0.5 + 0.5) * width,
    y: (-_world.y * 0.5 + 0.5) * height,
    visible,
  }
}
