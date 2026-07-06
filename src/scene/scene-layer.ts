import * as THREE from 'three'

/**
 * Owns ONLY the persistent pieces (spec §4): the single WebGLRenderer +
 * canvas, the camera, and an empty Scene with a background color. All world
 * content — lights, ground, robots — belongs to scene modules (§7) so M4's
 * suspend/dispose contract can free every scene-owned GPU resource.
 */
export class SceneLayer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x17161b)

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      100,
    )
    this.camera.position.set(1.4, 1.1, 1.4)

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    // re-read DPR: the window may have moved to a monitor with a different
    // scale factor (laptop ↔ projector), or browser zoom changed
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
