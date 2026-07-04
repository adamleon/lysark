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
  /** snap=true on scene boundaries — no camera continuity across scenes (§4.1);
      sceneDefaults seeds deterministic resolution of position-less specs */
  applyCamera(spec: CameraTargetSpec, opts: { snap: boolean; sceneDefaults?: CameraTargetSpec }): void
  /** fired after a boundary transition, with the new binding (null = scene-less) */
  onSceneChange?(binding: SceneInstance | null): void
  /** (re)build anchored labels for the destination slide (§4.2); runs for
      every slide, scene or scene-less, so stale anchors never linger */
  applyAnchors?(slide: CompiledSlide, binding: SceneInstance | null): void
  /** start/stop the destination slide's declarative idle oscillation (§11) */
  applyIdle?(slide: CompiledSlide, binding: SceneInstance | null): void
  /** fired for every destination slide (not just boundaries) — drives the
      presenter position indicator and overview highlight (§11) */
  onSlideChange?(index: number, slide: CompiledSlide): void
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
  /** a crossed boundary latched across supersession — the boundary belongs to
      the manager's state change, not to the navigation that requested it */
  private pendingBoundary = false
  /** destination overlay not shown yet: fragment keys must not touch the
      outgoing slide's DOM */
  private pendingShow = false

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
      // mid-transition the on-screen DOM is still the outgoing slide's;
      // show() reads visibleChunks when it fires, so the count arrives intact
      if (!this.pendingShow) this.opts.overlay.setVisibleChunks(this.visibleChunks)
      return
    }
    if (this.index + 1 < this.slideCount) this.goTo(this.index + 1, 'forward')
  }

  prev(): void {
    if (this.index < 0) return this.start()
    if (this.visibleChunks > 1) {
      this.visibleChunks--
      if (!this.pendingShow) this.opts.overlay.setVisibleChunks(this.visibleChunks)
      return
    }
    if (this.index > 0) this.goTo(this.index - 1, 'backward')
  }

  /** reveal every fragment of the current slide — the PDF exporter (§9c)
      wants each slide's complete end state, not its first reveal step */
  showAllFragments(): void {
    if (this.index < 0) return
    this.visibleChunks = this.current.fragments.length
    // during a pending transition the queued overlay.show reads visibleChunks
    // when it fires, so we only push the count directly when already shown
    if (!this.pendingShow) this.opts.overlay.setVisibleChunks(this.visibleChunks)
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
    this.pendingShow = true
    void this.transitionAndApply(slide, ++this.navSeq)
  }

  private async transitionAndApply(slide: CompiledSlide, seq: number): Promise<void> {
    const { binding, boundary } = await this.opts.scenes.transitionTo(slide.scene)
    // latch before the supersession check: if THIS navigation crossed the
    // boundary but a faster one wins, the survivor must still fire the
    // boundary side effects (snap camera, onSceneChange)
    this.pendingBoundary ||= boundary
    if (seq !== this.navSeq) return // superseded by faster navigation
    const crossed = this.pendingBoundary
    this.pendingBoundary = false
    if (binding && slide.scene) this.applyTargets(slide, binding, crossed)
    if (crossed) this.opts.onSceneChange?.(binding)
    // anchors/idle refresh on every slide (not just boundaries): moving within
    // a scene from a plain slide to an anchored one must swap them in, and a
    // scene-less slide must clear whatever the previous scene slide left up
    this.opts.applyAnchors?.(slide, binding)
    this.opts.applyIdle?.(slide, binding)
    this.pendingShow = false
    this.opts.overlay.show(slide, this.visibleChunks, this.opts.overlayCtx)
    // this.index is the survivor's index here (goTo set it synchronously)
    this.opts.onSlideChange?.(this.index, slide)
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
      if (widget.type !== 'slider' || !widget.pid) continue // plots carry no gains
      const pid = scene.channels[widget.bind]?.pid
      if (!pid) continue
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
    if (camera) {
      this.opts.applyCamera(camera, { snap: boundary, sceneDefaults: scene.defaults.camera })
    }
  }
}

export type { WidgetSpec }
