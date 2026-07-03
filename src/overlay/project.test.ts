import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { projectToScreen } from './project'

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
  cam.position.set(0, 0, 5)
  cam.lookAt(0, 0, 0)
  // precondition of projectToScreen: matrices current for the frame
  cam.updateMatrixWorld()
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
  return cam
}

describe('projectToScreen', () => {
  const W = 1920
  const H = 1080

  it('projects the look point to screen center', () => {
    const p = projectToScreen(new THREE.Vector3(0, 0, 0), camera(), W, H)
    expect(p.visible).toBe(true)
    expect(p.x).toBeCloseTo(W / 2, 3)
    expect(p.y).toBeCloseTo(H / 2, 3)
  })

  it('maps +x to the right and +y upward (screen y grows downward)', () => {
    const cam = camera()
    const right = projectToScreen(new THREE.Vector3(0.5, 0, 0), cam, W, H)
    const up = projectToScreen(new THREE.Vector3(0, 0.5, 0), cam, W, H)
    expect(right.x).toBeGreaterThan(W / 2)
    expect(right.y).toBeCloseTo(H / 2, 3)
    expect(up.y).toBeLessThan(H / 2)
    expect(up.x).toBeCloseTo(W / 2, 3)
  })

  it('marks a point behind the camera as not visible', () => {
    // camera sits at z=5 looking toward the origin; z=10 is behind it
    const p = projectToScreen(new THREE.Vector3(0, 0, 10), camera(), W, H)
    expect(p.visible).toBe(false)
  })
})
