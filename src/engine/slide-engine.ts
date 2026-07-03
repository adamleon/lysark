import type { CameraTargetSpec, CompiledSlide, WidgetSpec } from './slide-types'
import type { SceneInstance } from './scene-types'
import type { SceneManager } from './scene-manager'
import { mergeCameraSpec } from './camera-merge'
import { Overlay, type OverlayContext } from '../overlay/overlay'

export interface SlideEngineOptions {
  slides: CompiledSlide[]
  scenes: SceneManager
  overlay: Overlay
  overlayCtx: OverlayContext
  /** snap=true on scene boundaries — no camera continuity across scenes (§4.1) */
  applyCamera(spec: CameraTargetSpec, opts: { snap: boolean }): void
  /** fired after a boundary transition, with the new binding (null = scene-less) */
  onSceneChange?(binding: SceneInstance | null): void
}

/**
 * Deck runtime (spec §4.3/§6): owns the slide index and fragment state,
 * applies each destination slide's effective targets (merged over scene
 * defaults) to the motion channels and camera. Navigation is reversible by
 * construction because targets are cumulative. Scene changes go through the
 * SceneManager; a navigation sequence token drops superseded transitions.
 */
export class SlideEngine {
  private index = -1
  private visibleChunks = 1
  private navSeq = 0

  constructor(private readonly opts: SlideEngineOptions) {}

  get slideCount(): number {
    return this.opts.slides.length
  }

  get currentIndex(): number {
    return this.index
  }

  get current(): CompiledSlide {
    return this.opts.slides[this.index]
  }

  start(index = 0): void {
    this.goTo(Math.min(Math.max(index, 0), this.slideCount - 1), 'forward')
  }

  next(): void {
    if (this.index < 0) return this.start()
    if (this.visibleChunks < this.current.fragments.length) {
      this.visibleChunks++
      this.opts.overlay.setVisibleChunks(this.visibleChunks)
      return
    }
    if (this.index + 1 < this.slideCount) this.goTo(this.index + 1, 'forward')
  }

  prev(): void {
    if (this.index < 0) return this.start()
    if (this.visibleChunks > 1) {
      this.visibleChunks--
      this.opts.overlay.setVisibleChunks(this.visibleChunks)
      return
    }
    if (this.index > 0) this.goTo(this.index - 1, 'backward')
  }

  /**
   * Jump to a slide. Entering forward shows the first fragment; entering
   * backward shows all fragments (you step back into the slide's end state).
   */
  goTo(index: number, direction: 'forward' | 'backward' = 'forward'): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.slideCount || index === this.index) {
      return
    }
    const slide = this.opts.slides[index]
    this.index = index
    this.visibleChunks = direction === 'backward' ? slide.fragments.length : 1
    window.location.hash = String(index + 1)
    void this.transitionAndApply(slide, ++this.navSeq)
  }

  private async transitionAndApply(slide: CompiledSlide, seq: number): Promise<void> {
    const { binding, boundary } = await this.opts.scenes.transitionTo(slide.scene)
    if (seq !== this.navSeq) return // superseded by faster navigation
    if (binding && slide.scene) this.applyTargets(slide, binding, boundary)
    if (boundary) this.opts.onSceneChange?.(binding)
    this.opts.overlay.show(slide, this.visibleChunks, this.opts.overlayCtx)
  }

  private applyTargets(slide: CompiledSlide, scene: SceneInstance, boundary: boolean): void {
    // gains first: restore scene defaults, then this slide's widget overrides
    for (const [name, gains] of Object.entries(scene.defaultGains)) {
      const pid = scene.channels[name]?.pid
      if (!pid) continue
      pid.kp = gains.kp
      pid.ki = gains.ki
      pid.kd = gains.kd
    }
    for (const widget of slide.widgets) {
      const pid = scene.channels[widget.bind]?.pid
      if (!pid || !widget.pid) continue
      if (widget.pid.kp !== undefined) pid.kp = widget.pid.kp
      if (widget.pid.ki !== undefined) pid.ki = widget.pid.ki
      if (widget.pid.kd !== undefined) pid.kd = widget.pid.kd
    }

    // joints: scene defaults ⊕ cumulative declared targets (spec §4.3)
    const joints = { ...scene.defaults.joints, ...slide.effective.joints }
    for (const [name, value] of Object.entries(joints)) {
      const channel = scene.channels[name]
      if (!channel) {
        console.warn(`slide '${slide.id}': unknown joint channel '${name}'`)
        continue
      }
      channel.setpoint = value
    }

    // per-key merge over scene defaults, same semantics as joints (§4.3)
    const camera = mergeCameraSpec(scene.defaults.camera, slide.effective.camera)
    if (camera) this.opts.applyCamera(camera, { snap: boundary })
  }
}

export type { WidgetSpec }
