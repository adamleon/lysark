import * as THREE from 'three'

/**
 * Owns the single WebGLRenderer + canvas for the whole session (spec §4).
 * Scene graphs come and go; the renderer never does.
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
    this.scene.background = new THREE.Color(0x14161a)

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      100,
    )
    this.camera.position.set(1.4, 1.1, 1.4)

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
    this.scene.add(hemi, key)

    const grid = new THREE.GridHelper(5, 25, 0x3a4048, 0x272c33)
    this.scene.add(grid)

    // shadow catcher just below the grid to avoid z-fighting
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.001
    ground.receiveShadow = true
    this.scene.add(ground)

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
