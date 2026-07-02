import * as THREE from 'three'
import { SpringDamper } from '../engine/spring-damper'
import { MotionSystem, SpringChannel } from '../engine/motion-system'

/**
 * Spring-damper camera (spec §5): six channels — position xyz, look-at xyz —
 * sharing one SpringDamper so ω/ζ are live-tunable for the damping demo.
 * While inactive the channels shadow the externally-driven camera (orbit
 * controls) so a moveTo never starts from stale state.
 */
export class CameraController {
  readonly spring = new SpringDamper({ omega: 4, zeta: 1 })
  active = false

  private readonly pos: [SpringChannel, SpringChannel, SpringChannel]
  private readonly look: [SpringChannel, SpringChannel, SpringChannel]

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    motion: MotionSystem,
    look0: THREE.Vector3,
  ) {
    const mk = (name: string, x0: number) =>
      motion.add(name, new SpringChannel({ x0, spring: this.spring }))
    this.pos = [
      mk('camera.pos.x', camera.position.x),
      mk('camera.pos.y', camera.position.y),
      mk('camera.pos.z', camera.position.z),
    ]
    this.look = [
      mk('camera.look.x', look0.x),
      mk('camera.look.y', look0.y),
      mk('camera.look.z', look0.z),
    ]
  }

  get lookTarget(): THREE.Vector3 {
    return new THREE.Vector3(this.look[0].x, this.look[1].x, this.look[2].x)
  }

  moveTo(position: THREE.Vector3, look: THREE.Vector3): void {
    const pt = [position.x, position.y, position.z]
    const lt = [look.x, look.y, look.z]
    this.pos.forEach((ch, i) => (ch.target = pt[i]))
    this.look.forEach((ch, i) => (ch.target = lt[i]))
    this.active = true
  }

  /**
   * Call once per frame after MotionSystem.step. While active, writes the
   * camera from the channels and self-deactivates on settle; while inactive,
   * shadows the camera so channel state stays current.
   */
  update(externalLook: THREE.Vector3): void {
    if (this.active) {
      this.camera.position.set(this.pos[0].x, this.pos[1].x, this.pos[2].x)
      this.camera.lookAt(this.look[0].x, this.look[1].x, this.look[2].x)
      if (this.settledNow()) this.active = false
      return
    }
    this.pos[0].reset(this.camera.position.x)
    this.pos[1].reset(this.camera.position.y)
    this.pos[2].reset(this.camera.position.z)
    this.look[0].reset(externalLook.x)
    this.look[1].reset(externalLook.y)
    this.look[2].reset(externalLook.z)
  }

  private settledNow(): boolean {
    const eps = 2e-3
    return [...this.pos, ...this.look].every(
      (ch) => Math.abs(ch.error()) < eps && Math.abs(ch.velocity()) < eps,
    )
  }
}
