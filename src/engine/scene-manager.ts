import * as THREE from 'three'
import type { SceneLayer } from '../scene/scene-layer'
import { disposeSceneGraph } from '../scene/dispose'
import type { MotionSystem } from './motion-system'
import type { SceneInstance, SceneModule } from './scene-types'

export interface TransitionResult {
  binding: SceneInstance | null
  /** true when the scene changed — camera cuts instead of flying (§4.1) */
  boundary: boolean
}

const SNAPSHOT_FADE_MS = 350
const CANVAS_FADE_MS = 280
const DEFAULT_BACKGROUND = 0x14161a

/**
 * Owns the scene lifecycle (spec §4.1): at most one scene's GPU resources
 * alive at a time. Within a range nothing reloads; across a boundary the
 * outgoing scene is serialized and GPU-swept (CPU graph retained for fast
 * re-entry), and the visual transition is a snapshot crossfade — the old
 * scene's last frame fades out as a DOM image over the live new scene, so
 * two scenes never hold GPU resources simultaneously.
 */
export class SceneManager {
  private activeId: string | undefined
  private activeInstance: SceneInstance | null = null
  private readonly instances = new Map<string, SceneInstance>()
  private readonly saved = new Map<string, unknown>()
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly layer: SceneLayer,
    private readonly motion: MotionSystem,
    private readonly modules: Record<string, SceneModule>,
    private readonly container: HTMLElement,
  ) {}

  get active(): SceneInstance | null {
    return this.activeInstance
  }

  get activeSceneId(): string | undefined {
    return this.activeId
  }

  /** true while a transition (including its fades) is in progress */
  get busy(): boolean {
    return this.pending > 0
  }

  /** serialized: concurrent calls run in order, so rapid navigation is safe */
  transitionTo(sceneId: string | undefined): Promise<TransitionResult> {
    this.pending++
    const run = this.queue.then(() => this.doTransition(sceneId))
    this.queue = run.catch(() => undefined).then(() => {
      this.pending--
    })
    return run
  }

  private async doTransition(sceneId: string | undefined): Promise<TransitionResult> {
    if (sceneId === this.activeId) {
      return { binding: this.activeInstance, boundary: false }
    }
    const canvas = this.layer.renderer.domElement
    const hadScene = this.activeInstance !== null

    if (hadScene && sceneId !== undefined) {
      // scene → scene: capture the outgoing frame, swap under the snapshot
      this.layer.render()
      const snapshotUrl = canvas.toDataURL('image/png')
      this.suspendActive()
      await this.activate(sceneId)
      this.layer.render()
      this.fadeSnapshot(snapshotUrl)
    } else if (hadScene && sceneId === undefined) {
      // scene → scene-less: fade the canvas out, never yank it (§3)
      await this.fadeCanvas(0)
      this.suspendActive()
      canvas.style.visibility = 'hidden'
    } else if (sceneId !== undefined) {
      // scene-less → scene, or first activation: build/restore, fade in
      canvas.style.opacity = '0'
      canvas.style.visibility = 'visible'
      await this.activate(sceneId)
      this.layer.render()
      void this.fadeCanvas(1)
    }
    return { binding: this.activeInstance, boundary: true }
  }

  private suspendActive(): void {
    if (!this.activeInstance || this.activeId === undefined) return
    this.saved.set(this.activeId, this.activeInstance.serialize())
    for (const name of Object.keys(this.activeInstance.channels)) {
      this.motion.remove(`${this.activeId}.${name}`)
    }
    this.layer.scene.remove(this.activeInstance.root)
    // GPU-only sweep; the CPU graph is retained for near-instant re-entry (§4.1)
    disposeSceneGraph(this.activeInstance.root)
    this.activeInstance = null
    this.activeId = undefined
  }

  private async activate(sceneId: string): Promise<void> {
    const module = this.modules[sceneId]
    if (!module) throw new Error(`scene '${sceneId}' is not registered in the deck manifest`)
    let instance = this.instances.get(sceneId)
    if (!instance) {
      instance = await module.build()
      this.instances.set(sceneId, instance)
    } else {
      const saved = this.saved.get(sceneId)
      if (saved !== undefined) instance.restore(saved)
    }
    this.layer.scene.add(instance.root)
    const background = this.layer.scene.background as THREE.Color
    background.set(instance.background ?? DEFAULT_BACKGROUND)
    for (const [name, channel] of Object.entries(instance.channels)) {
      this.motion.add(`${sceneId}.${name}`, channel)
    }
    this.activeId = sceneId
    this.activeInstance = instance
  }

  private fadeSnapshot(url: string): void {
    const img = document.createElement('img')
    img.className = 'scene-snapshot'
    img.src = url
    this.container.appendChild(img)
    void img.offsetWidth // force reflow so the opacity transition runs
    img.style.opacity = '0'
    window.setTimeout(() => img.remove(), SNAPSHOT_FADE_MS + 100)
  }

  private fadeCanvas(to: 0 | 1): Promise<void> {
    this.layer.renderer.domElement.style.opacity = String(to)
    return new Promise((resolve) => window.setTimeout(resolve, CANVAS_FADE_MS))
  }
}
