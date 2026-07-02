import type { CameraTargetSpec, CompiledSlide, SlideTargets, WidgetSpec } from './slide-types'
import type { PidChannel } from './motion-system'
import { Overlay, type OverlayContext } from '../overlay/overlay'

export interface GainDefaults {
  kp: number
  ki: number
  kd: number
}

export interface SceneBinding {
  channels: Record<string, PidChannel>
  /** construction-time gains, restored on every slide enter before widget overrides */
  defaultGains: Record<string, GainDefaults>
  defaults: SlideTargets
}

export interface SlideEngineOptions {
  slides: CompiledSlide[]
  scene: SceneBinding
  overlay: Overlay
  overlayCtx: OverlayContext
  applyCamera(spec: CameraTargetSpec): void
}

/**
 * Deck runtime (spec §4.3/§6): owns the slide index and fragment state,
 * applies each destination slide's effective targets (merged over scene
 * defaults) to the motion channels and camera. Navigation is reversible by
 * construction because targets are cumulative.
 */
export class SlideEngine {
  private index = -1
  private visibleChunks = 1

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
    if (index < 0 || index >= this.slideCount || index === this.index) {
      if (index !== this.index) return
    }
    const slide = this.opts.slides[index]
    this.index = index
    this.visibleChunks = direction === 'backward' ? slide.fragments.length : 1

    this.applyTargets(slide)
    this.opts.overlay.show(slide, this.visibleChunks, this.opts.overlayCtx)
    window.location.hash = String(index + 1)
  }

  private applyTargets(slide: CompiledSlide): void {
    const { scene, applyCamera } = this.opts

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

    const camera = slide.effective.camera ?? scene.defaults.camera
    if (camera) applyCamera(camera)
  }
}

export type { WidgetSpec }
