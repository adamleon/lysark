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

export interface PlotWidgetSpec {
  type: 'plot'
  /**
   * Channel name, optionally suffixed with a derived field:
   * `joint2` (measured), `joint2.setpoint`, or `joint2.error` (§7).
   */
  bind: string
  label?: string
  /** fixed y-axis range; uPlot auto-scales when omitted */
  range?: [number, number]
  /** seconds of history shown in the scrolling window (default 6) */
  window?: number
}

export type WidgetSpec = SliderWidgetSpec | PlotWidgetSpec

/** anchor-mode overlay element (spec §4.2): a DOM label pinned to a 3D node */
export interface AnchoredSpec {
  /** named anchor node from the scene module (§7) */
  anchor: string
  /** screen-space pixel offset [dx, dy] applied after projection */
  offset: [number, number]
  /** pre-rendered inline HTML (markdown + KaTeX) */
  html: string
}

/** one declarative idle oscillation channel (reference example, §11) */
export interface IdleOsc {
  /** amplitude in radians */
  amp: number
  /** cycles per second */
  freq: number
  /** phase offset in radians */
  phase: number
  /** oscillation center; defaults to the slide's resolved setpoint at runtime */
  center?: number
}

export interface SlideTargets {
  joints?: Record<string, number>
  camera?: CameraTargetSpec
}

export interface CompiledSlide {
  id: string
  /** plaintext title from the slide's first heading (falls back to id);
      used by the presenter overview (§11) — never rendered as markup */
  title: string
  scene?: string
  layout: 'panel' | 'center'
  /**
   * Cumulative declared targets within this slide's contiguous scene run
   * (spec §4.3): per-key inheritance from earlier slides in the same range,
   * reset at every scene boundary — targets never leak across scenes (§4.1).
   * The runtime merges this over the scene module's defaults, which the
   * build step cannot know. Empty for scene-less slides.
   */
  effective: SlideTargets
  widgets: WidgetSpec[]
  /** anchor-mode overlay elements (§4.2); empty for scene-less slides */
  anchored: AnchoredSpec[]
  /**
   * Declarative idle oscillation per channel (spec §11 reference example):
   * while the slide shows, setpoints sweep sinusoidally around their resolved
   * pose. Undefined = none. Scene slides only.
   */
  idle?: Record<string, IdleOsc>
  /** rendered HTML chunks; chunk 0 is always visible, the rest are fragments */
  fragments: string[]
}
