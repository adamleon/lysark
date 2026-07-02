/**
 * Shared slide-object types (spec §8). Browser-safe — the compiler that
 * produces these lives in src/compiler and runs only at build time.
 */

export interface CameraTargetSpec {
  /** anchor name from the scene module, or an explicit point */
  lookAt?: string | [number, number, number]
  /** camera position = look point + offset (explicit framing) */
  offset?: [number, number, number]
  /** keep the current view direction, set the camera-to-look distance */
  distance?: number
  spring?: { omega?: number; zeta?: number }
}

export interface SliderWidgetSpec {
  type: 'slider'
  /** channel name in the slide's scene (e.g. a joint) */
  bind: string
  label?: string
  range?: [number, number]
  /** per-widget gain overrides, restored to scene defaults on slide exit */
  pid?: { kp?: number; ki?: number; kd?: number }
}

export type WidgetSpec = SliderWidgetSpec

export interface SlideTargets {
  joints?: Record<string, number>
  camera?: CameraTargetSpec
}

export interface CompiledSlide {
  id: string
  scene?: string
  layout: 'panel' | 'center'
  /**
   * Cumulative declared targets up to and including this slide (spec §4.3):
   * per-key inheritance from earlier slides. The runtime merges this over the
   * scene module's defaults, which the build step cannot know.
   */
  effective: SlideTargets
  widgets: WidgetSpec[]
  /** rendered HTML chunks; chunk 0 is always visible, the rest are fragments */
  fragments: string[]
}
