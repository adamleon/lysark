/**
 * Shared slide-object types (spec §8). Browser-safe — the compiler that
 * produces these lives in src/compiler and runs only at build time.
 */

import type { ProfileName } from './time-scaling'

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

/**
 * A static plot of a time-scaling profile s(t) and its derivatives over the
 * normalized domain τ ∈ [0,1] (trajectory-planning lecture). Unlike the live
 * `plot` widget it binds to no channel — it draws the analytic curves so the
 * cubic's nonzero-endpoint acceleration and the quintic's zero-endpoint
 * acceleration are directly comparable. A marker tracks the robot's live phase.
 */
export interface CurveWidgetSpec {
  type: 'curve'
  /** which time-scaling to plot */
  profile: ProfileName
  /** which curves to draw: position s, velocity ṡ, acceleration s̈ (default all) */
  show: ('s' | 'v' | 'a')[]
  label?: string
}

/**
 * The manual path-parameter slider (trajectory-planning lecture): a slider s ∈
 * [0,1] that scrubs the whole robot along the slide's trajectory path q(s) =
 * q₀ + s·(q_f − q₀). Used on the "bane" slide to show a path as pure geometry —
 * no time. Requires a `trajectory` with `control: slider`.
 */
export interface PathWidgetSpec {
  type: 'path'
  label?: string
}

/**
 * A two-state toggle (trajectory-planning lecture): swaps which of the two
 * overlaid robots on a comparison slide is drawn solid vs. ghost. `labels` names
 * the two so the button can read "Fremhevet: <name>".
 */
export interface ToggleWidgetSpec {
  type: 'toggle'
  /** the two robots/profiles, in order (index 0 solid by default) */
  labels: [string, string]
  label?: string
}

/**
 * Transport control for a `control: time` trajectory: a Run/Pause button plus a
 * normalized-time slider. Running loops the motion; dragging the slider pauses
 * and scrubs. Both write the shared time the graph marker reads.
 */
export interface TransportWidgetSpec {
  type: 'transport'
  label?: string
}

/**
 * Comparison plot: one selectable quantity (position s, velocity ṡ, or
 * acceleration s̈) drawn for TWO time-scaling profiles at once, over normalized
 * time τ ∈ [0,1], on a shared scale. A marker tracks the robots' live time.
 */
export interface CompareWidgetSpec {
  type: 'compare'
  /** the two profiles to overlay */
  profiles: [ProfileName, ProfileName]
  /** legend names for the two profiles */
  labels: [string, string]
  /** selectable quantities (default all three) */
  quantities: ('s' | 'v' | 'a')[]
  label?: string
}

/**
 * Plot of the driven joints' values vs. the path parameter s (PTP/Lin slides).
 * The curves are computed from the trajectory: PTP (joint space) gives straight
 * lines; Lin (task space, IK) gives curved ones — the joint-space counterpart of
 * the traced tool paths. A marker tracks the live s.
 */
export interface JointGraphWidgetSpec {
  type: 'jointgraph'
  label?: string
}

export type WidgetSpec =
  | SliderWidgetSpec
  | PlotWidgetSpec
  | CurveWidgetSpec
  | PathWidgetSpec
  | ToggleWidgetSpec
  | TransportWidgetSpec
  | CompareWidgetSpec
  | JointGraphWidgetSpec

/**
 * Kinematic path playback (trajectory-planning lecture): move the whole robot
 * from configuration q₀ (`from`) to q_f (`to`) along one shared path parameter
 * s, driving every listed joint by q(s) = from + s·(to − from). Each joint
 * replays the position EXACTLY (PidChannel.playback), so the robot's motion is
 * the geometry/curve on screen.
 *
 * `control: auto` advances s = s(t) along the time-scaling `profile`,
 * ping-ponging with a dwell at each end (the cubic/quintic slides).
 * `control: slider` leaves s to a manual `path` widget (the geometry-only
 * "bane" slide) — `profile`/`duration` are then unused.
 */
export interface TrajectorySpec {
  /** joint → value at s=0 (q₀); every key must also appear in `to` */
  from: Record<string, number>
  /** joint → value at s=1 (q_f) */
  to: Record<string, number>
  /**
   * `auto` loops s(t); `slider` exposes a manual path-parameter widget; `time`
   * exposes a transport (run/pause + normalized-time scrub) driving both robots
   * and the comparison graph on one clock.
   */
  control: 'auto' | 'slider' | 'time'
  /**
   * Where the straight line lives. `joint` (default) is PTP/MoveJ — linear in
   * joint space, so the tool traces a curve. `task` is Lin/MoveL — the tool goes
   * straight in task space, joints solved by IK each step (needs a scene with `ik`).
   */
  space: 'joint' | 'task'
  /**
   * Reference paths to draw for contrast: 'joint' = the curved PTP tool path,
   * 'task' = the straight Lin line. Both are computed from the scene's FK.
   */
  trace: ('joint' | 'task')[]
  profile: ProfileName
  /**
   * Second profile run simultaneously on a parallel "ghost" robot (agilus-duo
   * comparison slide). Drives channels `ghost_<joint>` on the same clock, so the
   * two robots share q₀/q_f but differ in timing. Undefined = single robot.
   */
  compare?: ProfileName
  /** seconds for one q₀→q_f leg (auto mode) */
  duration: number
  /** seconds held at each end before reversing (auto mode) */
  dwell: number
}

/** a DOM label pinned to a 3D node (spec §4.2), with static pre-rendered HTML */
export interface AnchoredLabelSpec {
  kind: 'label'
  /** named anchor node from the scene module (§7) */
  anchor: string
  /** screen-space pixel offset [dx, dy] applied after projection */
  offset: [number, number]
  /** pre-rendered inline HTML (markdown + KaTeX) */
  html: string
}

/**
 * A live configuration vector pinned to a 3D node (§4.2): a column of the named
 * channels' current measured values, refreshed every frame. Makes the abstract
 * "a configuration is the vector of joint values" concrete on the robot itself.
 */
export interface AnchoredVectorSpec {
  kind: 'vector'
  anchor: string
  offset: [number, number]
  /** pre-rendered KaTeX for the leading symbol, e.g. "q =" */
  symbolHtml: string
  /** channel names whose measured value fills the rows, top to bottom */
  channels: string[]
  /** decimal places shown per row */
  digits: number
}

/** anchor-mode overlay element (spec §4.2): static label or live value vector */
export type AnchoredSpec = AnchoredLabelSpec | AnchoredVectorSpec

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
  /** kinematic profile playback on one joint (trajectory lecture); scene slides only */
  trajectory?: TrajectorySpec
  /** rendered HTML chunks; chunk 0 is always visible, the rest are fragments */
  fragments: string[]
}
