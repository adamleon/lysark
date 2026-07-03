import type * as THREE from 'three'
import type { PidChannel } from './motion-system'
import type { SlideTargets } from './slide-types'

export interface GainDefaults {
  kp: number
  ki: number
  kd: number
}

/**
 * Live scene per spec §7: owns its graph (including lights/ground — the
 * persistent SceneLayer owns none of the world), named anchors, motion
 * channels, and the serialize/restore/dispose lifecycle contract (§4.1).
 */
export interface SceneInstance {
  root: THREE.Object3D
  /** scene-specific clear color, applied while this scene is active */
  background?: number
  anchors: Record<string, THREE.Object3D>
  channels: Record<string, PidChannel>
  /** effective-target base for slide 1 of the scene's range (§4.3) */
  defaults: SlideTargets
  /** gains restored on every slide enter, before widget overrides */
  defaultGains: Record<string, GainDefaults>
  serialize(): unknown
  restore(state: unknown): void
  /** full teardown — the fallback path when a scene is truly destroyed */
  dispose(): void
}

export interface SceneModule {
  id: string
  build(): SceneInstance | Promise<SceneInstance>
}
