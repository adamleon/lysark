import * as THREE from 'three'
import { SpringDamper } from '../engine/spring-damper'
import { MotionSystem, SpringChannel } from '../engine/motion-system'

/**
 * Spring-damper camera (spec §5): six channels — position xyz, look-at xyz —
 * sharing one SpringDamper so ω/ζ are live-tunable for the damping demo.
 *
 * Handoff discipline (from the M2 review): moveTo re-seeds the channels from
 * the LIVE camera pose synchronously at call time, so a flight never starts
 * from the one-frame-stale idle shadow; syncIdle shadows the externally-driven
 * camera and must be called AFTER orbit controls update, not before.
 */
export class CameraController {
  readonly spring = new SpringDamper({ omega: 4, zeta: 1 })
  active = false

  /** camera never gets closer to the look point than this (lookAt degeneracy guard) */
  static readonly MIN_LOOK_DISTANCE = 0.1

  private readonly pos: [SpringChannel, SpringChannel, SpringChannel]
  private readonly look: [SpringChannel, SpringChannel, SpringChannel]
  private readonly lastDir = new THREE.Vector3(0, 0, 1)

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

  moveTo(position: THREE.Vector3, look: THREE.Vector3, fromLook: THREE.Vector3): void {
    if (!this.active) {
      // idle → flight: seed from the live externally-driven pose. Mid-flight
      // re-targets skip this — the channels already hold the current pose AND
      // velocity, so the new flight blends continuously instead of snapping
      // back to the stale pre-flight framing.
      const c = this.camera.position
      this.pos[0].reset(c.x)
      this.pos[1].reset(c.y)
      this.pos[2].reset(c.z)
      this.look[0].reset(fromLook.x)
      this.look[1].reset(fromLook.y)
      this.look[2].reset(fromLook.z)
    }
    this.pos[0].target = position.x
    this.pos[1].target = position.y
    this.pos[2].target = position.z
    this.look[0].target = look.x
    this.look[1].target = look.y
    this.look[2].target = look.z
    this.active = true
  }

  /** abort mid-flight, freezing at the current pose */
  cancel(): void {
    if (!this.active) return
    this.active = false
    for (const ch of [...this.pos, ...this.look]) ch.reset(ch.x)
  }

  /**
   * Active path — call once per frame after MotionSystem.step. Writes the
   * camera from the channels; returns true on the frame the flight settles.
   */
  drive(): boolean {
    if (!this.active) return false
    const look = new THREE.Vector3(this.look[0].x, this.look[1].x, this.look[2].x)
    const pos = new THREE.Vector3(this.pos[0].x, this.pos[1].x, this.pos[2].x)
    const offset = pos.clone().sub(look)
    if (offset.length() < CameraController.MIN_LOOK_DISTANCE) {
      // underdamped overshoot can carry the camera through the look point
      const dir = offset.lengthSq() > 1e-12 ? offset.normalize() : this.lastDir
      pos.copy(look).addScaledVector(dir, CameraController.MIN_LOOK_DISTANCE)
    } else {
      this.lastDir.copy(offset.normalize())
    }
    this.camera.position.copy(pos)
    this.camera.lookAt(look)
    if (this.settledNow()) {
      this.active = false
      return true
    }
    return false
  }

  /** idle path — call once per frame AFTER orbit controls have updated */
  syncIdle(externalLook: THREE.Vector3): void {
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
