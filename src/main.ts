import './styles.css'
import 'katex/dist/katex.min.css'
import 'uplot/dist/uPlot.min.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { CameraController } from './scene/camera-controller'
import { createSlider } from './overlay/widgets/slider'
import { createPlot } from './overlay/widgets/plot'
import { createCurve } from './overlay/widgets/curve'
import { createToggle } from './overlay/widgets/toggle'
import { createTransport } from './overlay/widgets/transport'
import { createCompare } from './overlay/widgets/compare-curve'
import { createJointGraph, type JointSeries } from './overlay/widgets/joints-graph'
import { PROFILES, type TimeScaling } from './engine/time-scaling'
import type { IkSolver } from './scene/ik'
import { Overlay, type WidgetHandle } from './overlay/overlay'
import { AnchorLayer } from './overlay/anchor-layer'
import { Presenter } from './overlay/presenter'
import { MotionSystem, type PidChannel } from './engine/motion-system'
import { SceneManager } from './engine/scene-manager'
import { SlideEngine } from './engine/slide-engine'
import { parseBinding, readField } from './engine/channel-binding'
import type { SceneInstance } from './engine/scene-types'
import type { CameraTargetSpec, CompiledSlide, TrajectorySpec, WidgetSpec } from './engine/slide-types'
import deck from '@active-deck'

const sceneLayer = new SceneLayer(document.getElementById('scene-layer')!)
const motion = new MotionSystem()
const sceneManager = new SceneManager(
  sceneLayer,
  motion,
  deck.scenes,
  document.getElementById('scene-layer')!,
)

// reference-path lines (PTP curve / Lin straight line) — geometry only, never
// text (§4.2). Lives beside the scene root so it survives scene swaps; rebuilt
// per slide by applyTraces.
const traceGroup = new THREE.Group()
traceGroup.name = 'trace-layer'
sceneLayer.scene.add(traceGroup)

function clearTraces(): void {
  for (const child of traceGroup.children) {
    const line = child as THREE.Line
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
  }
  traceGroup.clear()
}

function drawTrace(points: THREE.Vector3[], color: number): void {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  traceGroup.add(new THREE.Line(geometry, material))
}

/** draw the requested reference paths from the slide's q₀/q_f via the scene FK */
function applyTraces(spec: TrajectorySpec, ik: IkSolver | null): void {
  clearTraces()
  if (!ik || spec.trace.length === 0) return
  const names = Object.keys(spec.from)
  if (spec.trace.includes('joint')) {
    // PTP: FK of the joint-space straight line → a curve in task space
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 48; i++) {
      const s = i / 48
      const q: Record<string, number> = {}
      for (const n of names) q[n] = spec.from[n] + s * (spec.to[n] - spec.from[n])
      pts.push(ik.fk(q))
    }
    drawTrace(pts, 0xf5c542) // cheese/gold curve
  }
  if (spec.trace.includes('task')) {
    // Lin: the straight line between the two tool poses
    drawTrace([ik.fk(spec.from), ik.fk(spec.to)], 0x3fc46a) // green straight line
  }
}

const JOINT_MOVE_EPS = 0.05

function jointLabel(name: string): string {
  const m = /(\d+)$/.exec(name)
  return m ? `q${m[1]}` : name
}

/** sample the joint-value curves q(s): PTP analytic (straight), Lin via IK (curved) */
function computeJointSamples(
  spec: TrajectorySpec,
  ik: IkSolver | null,
): { s: number[]; series: JointSeries[] } {
  const names = Object.keys(spec.from)
  const STEPS = 36
  const sArr: number[] = []
  const raw: Record<string, number[]> = {}
  for (const n of names) raw[n] = []

  if (spec.space === 'task' && ik) {
    const xA = ik.fk(spec.from)
    const xB = ik.fk(spec.to)
    const live = ik.getJoints()
    ik.setJoints(spec.from) // warm-start the sweep at q₀
    for (let i = 0; i <= STEPS; i++) {
      const s = i / STEPS
      sArr.push(s)
      const q = ik.solve(xA.clone().lerp(xB, s), { iterations: 20 })
      for (const n of names) raw[n].push(q[n])
    }
    ik.setJoints(live) // leave the robot as we found it
  } else {
    for (let i = 0; i <= STEPS; i++) {
      const s = i / STEPS
      sArr.push(s)
      for (const n of names) raw[n].push(spec.from[n] + s * (spec.to[n] - spec.from[n]))
    }
  }

  // only the joints that actually move (drop the constant ones)
  const series: JointSeries[] = []
  for (const n of names) {
    const vals = raw[n]
    if (Math.max(...vals) - Math.min(...vals) < JOINT_MOVE_EPS) continue
    series.push({ label: jointLabel(n), values: vals })
  }
  return { s: sArr, series }
}

const controls = new OrbitControls(sceneLayer.camera, sceneLayer.renderer.domElement)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true

const cameraCtl = new CameraController(sceneLayer.camera, motion, controls.target.clone())

// flush frozen orbit damping so residual flick inertia can't replay after a
// flight or over a boundary snap; the non-damping update applies and zeroes
// it in one call
function flushOrbitInertia(): void {
  controls.enableDamping = false
  controls.update()
  controls.enableDamping = true
}

function flyTo(position: THREE.Vector3, look: THREE.Vector3): void {
  if (!cameraCtl.active) {
    // Skipped mid-flight: controls are already disabled and the flush's
    // update() would lookAt the stale pre-flight target, snapping the view.
    flushOrbitInertia()
    controls.enabled = false
  }
  cameraCtl.moveTo(position, look, controls.target)
}

// clicking the scene cancels an active flight instead of locking input out
sceneLayer.renderer.domElement.addEventListener('pointerdown', () => {
  if (!cameraCtl.active) return
  cameraTrack = null
  cameraCtl.cancel()
  controls.target.copy(cameraCtl.lookTarget)
  controls.enabled = true
})

// ---------------------------------------------------------------------------
// Camera spec resolution (anchors come from the ACTIVE scene)
// ---------------------------------------------------------------------------

interface CameraPose {
  position: THREE.Vector3
  look: THREE.Vector3
}

/**
 * seed replaces the live camera as the reference for position-less specs
 * (distance / lookAt-only) — on scene boundaries the live camera still holds
 * the OUTGOING scene's pose, which must not leak across (§4.1).
 */
function resolveCameraPose(spec: CameraTargetSpec, seed?: CameraPose): CameraPose | null {
  let look: THREE.Vector3
  if (typeof spec.lookAt === 'string') {
    const anchor = sceneManager.active?.anchors[spec.lookAt]
    if (!anchor) {
      console.warn(`camera lookAt: unknown anchor '${spec.lookAt}'`)
      return null
    }
    look = anchor.getWorldPosition(new THREE.Vector3())
  } else if (Array.isArray(spec.lookAt)) {
    look = new THREE.Vector3(...spec.lookAt)
  } else {
    look = seed?.look ?? cameraCtl.lookTarget
  }

  const reference = seed?.position ?? sceneLayer.camera.position
  let position: THREE.Vector3
  if (spec.offset) {
    position = look.clone().add(new THREE.Vector3(...spec.offset))
  } else if (spec.distance !== undefined) {
    const dir = reference.clone().sub(look)
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.5, 1)
    position = look.clone().addScaledVector(dir.normalize(), spec.distance)
  } else {
    position = reference.clone()
  }
  return { position, look }
}

// anchor-based camera targets track the anchor while the flight is active —
// a slide that moves both joints and camera must settle on where the anchor
// ENDS UP, not where it was at slide entry
let cameraTrack: CameraTargetSpec | null = null

// spring gains reset to these on every slide camera application — mirrors the
// defaultGains pattern for PID, keeping backward navigation reversible (§4.3)
const springDefaults = { omega: cameraCtl.spring.omega, zeta: cameraCtl.spring.zeta }

function applyCameraSpec(
  spec: CameraTargetSpec,
  { snap, sceneDefaults }: { snap: boolean; sceneDefaults?: CameraTargetSpec },
): void {
  cameraTrack = null // never leave a previous slide's anchor spec live
  cameraCtl.spring.omega = spec.spring?.omega ?? springDefaults.omega
  cameraCtl.spring.zeta = spec.spring?.zeta ?? springDefaults.zeta

  // boundary entries must not depend on the outgoing scene's pose (§4.1):
  // seed position-less specs from the scene's default framing
  let seed: CameraPose | undefined
  if (snap && !spec.offset && sceneDefaults?.offset) {
    seed = resolveCameraPose(sceneDefaults) ?? undefined
  }
  const pose = resolveCameraPose(spec, seed)
  if (!pose) {
    if (snap) {
      // content typo (unknown anchor): degrade to a warning, but still
      // complete the handback so the camera state machine stays sane
      cameraCtl.cancel()
      controls.target.copy(cameraCtl.lookTarget)
      controls.enabled = true
    }
    return
  }
  cameraTrack = typeof spec.lookAt === 'string' ? spec : null
  if (snap) {
    // scene boundary: hard cut (§4.1), then — for anchor targets — a zero-
    // length flight so tracking follows the anchor while the robot settles
    flushOrbitInertia()
    cameraCtl.snapTo(pose.position, pose.look)
    controls.target.copy(pose.look)
    controls.enabled = true
    if (cameraTrack) {
      controls.enabled = false
      cameraCtl.moveTo(pose.position, pose.look, controls.target)
    }
    return
  }
  flyTo(pose.position, pose.look)
}

// ---------------------------------------------------------------------------
// Slide deck
// ---------------------------------------------------------------------------

const overlayHost = document.getElementById('overlay-layer')!
const overlay = new Overlay(overlayHost)

// anchored labels get their own inset layer so per-frame projection never
// disturbs the screen-mode slide content (§4.2)
const anchorHost = document.createElement('div')
anchorHost.className = 'anchor-layer'
overlayHost.appendChild(anchorHost)
const anchorLayer = new AnchorLayer(anchorHost)

function createWidget(spec: WidgetSpec): WidgetHandle | null {
  // curve plots an analytic profile — no channel binding, no active scene needed
  if (spec.type === 'curve') {
    return createCurve({
      label: spec.label ?? `Tidsskalering – ${spec.profile}`,
      profile: spec.profile,
      show: spec.show,
      phase: () => trajS,
    })
  }
  // path: a manual slider for the shared path parameter s (scrubs q(s))
  if (spec.type === 'path') {
    return {
      el: createSlider({
        label: spec.label ?? 's',
        min: 0,
        max: 1,
        step: 0.005,
        value: trajS,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          trajS = v
          ensureTicking()
        },
      }).el,
    }
  }
  // toggle: swap which overlaid robot is solid vs. ghost (comparison slide)
  if (spec.type === 'toggle') {
    return {
      el: createToggle({
        labels: spec.labels,
        heading: spec.label,
        onToggle: (solidIndex) => {
          const active = sceneManager.active as unknown as { setSolid?: (i: number) => void } | null
          active?.setSolid?.(solidIndex)
          ensureTicking()
        },
      }).el,
    }
  }
  // transport: Run/Pause + normalized-time scrub for a `control: time` slide
  if (spec.type === 'transport') {
    return createTransport({
      label: spec.label,
      isRunning: () => trajRunning,
      setRunning: (running) => {
        trajRunning = running
        ensureTicking()
      },
      getTime: () => trajTime,
      setTime: (u) => {
        trajTime = Math.min(Math.max(u, 0), 1)
        trajRunning = false // scrubbing pauses the loop
        ensureTicking()
      },
    })
  }
  // compare: one quantity (pos/vel/acc) plotted for two profiles at once
  if (spec.type === 'compare') {
    return createCompare({
      profiles: spec.profiles,
      labels: spec.labels,
      quantities: spec.quantities,
      phase: () => trajTime,
    })
  }
  // jointgraph: the driven joints' values vs s (PTP straight, Lin curved)
  if (spec.type === 'jointgraph') {
    if (!trajJointSamples || trajJointSamples.series.length === 0) return null
    return createJointGraph({
      label: spec.label ?? 'Leddverdier q(s)',
      s: trajJointSamples.s,
      series: trajJointSamples.series,
      phase: () => trajS,
    })
  }
  const binding = sceneManager.active
  if (!binding) {
    console.warn(`widget bind: no active scene for '${spec.bind}'`)
    return null
  }
  if (spec.type === 'plot') {
    const { channel, field } = parseBinding(spec.bind)
    const ch = binding.channels[channel]
    if (!ch) {
      console.warn(`plot bind: unknown channel '${channel}'`)
      return null
    }
    return createPlot({
      label: spec.label ?? spec.bind,
      range: spec.range,
      window: spec.window ?? 6,
      sample: () => readField(ch, field),
    })
  }

  const channel = binding.channels[spec.bind]
  if (!channel) {
    console.warn(`widget bind: unknown channel '${spec.bind}'`)
    return null
  }
  const limits = spec.range ?? [channel.min, channel.max]
  return {
    el: createSlider({
      label: spec.label ?? spec.bind,
      min: limits[0],
      max: limits[1],
      value: channel.setpoint,
      format: (v) => `${v.toFixed(2)} rad`,
      onInput: (v) => {
        channel.setpoint = v
        ensureTicking()
      },
    }).el,
  }
}

// ---------------------------------------------------------------------------
// Anchored labels + declarative idle animation (§4.2, §11)
// ---------------------------------------------------------------------------

function applyAnchors(slide: CompiledSlide, binding: SceneInstance | null): void {
  anchorLayer.show(slide.anchored, binding)
  ensureTicking()
}

// idle: while a slide with an `idle:` block shows, its channels' setpoints
// sweep sinusoidally around the pose applyTargets resolved. Cleared on any
// slide without idle, so the next slide's static targets take over cleanly.
let idleSpecs: CompiledSlide['idle'] | null = null
let idleChannels: Record<string, PidChannel> | null = null
const idleBase = new Map<string, number>()
let idleT0 = 0

function applyIdle(slide: CompiledSlide, binding: SceneInstance | null): void {
  idleBase.clear()
  if (!slide.idle || !binding) {
    idleSpecs = null
    idleChannels = null
    return
  }
  idleSpecs = slide.idle
  idleChannels = binding.channels
  for (const name of Object.keys(slide.idle)) {
    const ch = binding.channels[name]
    if (!ch) {
      console.warn(`idle: unknown channel '${name}'`)
      continue
    }
    // center defaults to the setpoint applyTargets just resolved for this slide
    idleBase.set(name, ch.setpoint)
  }
  idleT0 = performance.now()
  ensureTicking()
}

function stepIdle(now: number): void {
  if (!idleSpecs || !idleChannels) return
  const t = (now - idleT0) / 1000
  for (const [name, osc] of Object.entries(idleSpecs)) {
    const ch = idleChannels[name]
    if (!ch) continue
    const center = osc.center ?? idleBase.get(name) ?? 0
    ch.setpoint = center + osc.amp * Math.sin(2 * Math.PI * osc.freq * t + osc.phase)
  }
}

// ---------------------------------------------------------------------------
// Kinematic path playback (trajectory lecture): move the WHOLE robot from q₀ to
// q_f along one shared path parameter s. Every listed joint replays q(s) =
// from + s·(to − from) EXACTLY via PidChannel.playback (no PID lag), so the
// robot's motion is the geometry/curve on screen. `auto` advances s = s(t) along
// the profile (ping-pong + dwell); `slider` leaves s to the path widget. trajS
// is the shared phase the curve widget's marker reads.
interface TrajJoint {
  ch: PidChannel
  name: string
  from: number
  to: number
}
// a track = one profile driving one set of channels; a comparison slide runs two
// (primary on `joint_*`, `compare` on `ghost_joint_*`) on the same clock
interface TrajTrack {
  prof: TimeScaling
  joints: TrajJoint[]
}
let trajSpec: TrajectorySpec | null = null
let trajTracks: TrajTrack[] = []
let trajArmed = false // engaged only after PID has eased the robot(s) to q₀
let trajArmStart = 0
let trajT0 = 0
let trajS = 0
// `time` control (comparison slide): a normalized time u the transport drives
let trajRunning = true
let trajTime = 0
let trajDir: 1 | -1 = 1
let trajDwell = 0
let trajLastNow = 0
// task-space (Lin) driving: solve IK toward a point on the straight line each frame
let trajIk: IkSolver | null = null
const trajTaskA = new THREE.Vector3()
const trajTaskB = new THREE.Vector3()
// precomputed joint-value curves q(s) for the joint-space graph (PTP/Lin)
let trajJointSamples: { s: number[]; series: JointSeries[] } | null = null

function applyTrack(track: TrajTrack, s: number, sVel: number): void {
  for (const j of track.joints) {
    const span = j.to - j.from
    j.ch.playback = { x: j.from + s * span, v: sVel * span }
  }
}

function buildTrack(
  spec: TrajectorySpec,
  binding: SceneInstance,
  profileName: 'cubic' | 'quintic' | 'trapezoidal',
  chanKey: (joint: string) => string,
): TrajTrack {
  const joints: TrajJoint[] = []
  for (const name of Object.keys(spec.from)) {
    const ch = binding.channels[chanKey(name)]
    if (!ch) {
      console.warn(`trajectory: unknown channel '${chanKey(name)}'`)
      continue
    }
    joints.push({ ch, name, from: spec.from[name], to: spec.to[name] })
  }
  return { prof: PROFILES[profileName], joints }
}

function applyTrajectory(slide: CompiledSlide, binding: SceneInstance | null): void {
  // release whatever the previous slide was driving
  for (const t of trajTracks) for (const j of t.joints) j.ch.playback = null
  trajSpec = null
  trajTracks = []
  trajArmed = false
  trajIk = null
  trajJointSamples = null
  clearTraces()
  if (!slide.trajectory || !binding) return
  const spec = slide.trajectory
  const tracks: TrajTrack[] = [buildTrack(spec, binding, spec.profile, (n) => n)]
  if (spec.compare) tracks.push(buildTrack(spec, binding, spec.compare, (n) => `ghost_${n}`))
  trajSpec = spec
  trajTracks = tracks
  trajS = 0
  trajRunning = true // `time` slides auto-play on entry; the transport can pause
  trajTime = 0
  trajDir = 1
  trajDwell = 0

  // task-space (Lin): precompute the straight tool line xA→xB (world) via FK;
  // also used, with FK, to draw the reference paths
  const ik = (binding as unknown as { ik?: IkSolver }).ik ?? null
  if (spec.space === 'task') {
    if (ik) {
      trajIk = ik
      trajTaskA.copy(ik.fk(spec.from))
      trajTaskB.copy(ik.fk(spec.to))
    } else {
      console.warn(`trajectory space:task but scene '${sceneManager.activeSceneId}' exposes no ik`)
    }
  }
  applyTraces(spec, ik)
  trajJointSamples = computeJointSamples(spec, ik)

  // ease to q₀ under PID first (no teleport between poses); kinematic playback
  // engages only once the robot(s) have arrived (stepTrajectory arms it)
  for (const t of trajTracks) for (const j of t.joints) j.ch.setpoint = j.from
  trajArmStart = performance.now()
  ensureTicking()
}

/** Lin/MoveL: place the tool at fraction s along the straight line, joints via IK */
function applyTaskIk(s: number): void {
  if (!trajIk) return
  const target = trajTaskA.clone().lerp(trajTaskB, s)
  const solution = trajIk.solve(target, { iterations: 15 })
  for (const track of trajTracks) {
    for (const j of track.joints) {
      j.ch.playback = { x: solution[j.name] ?? j.from + s * (j.to - j.from), v: 0 }
    }
  }
}

/** ping-pong the normalized time u ∈ [0,1] with a dwell at each end (time mode) */
function advanceTime(dt: number): void {
  if (!trajSpec) return
  if (trajDwell > 0) {
    trajDwell -= dt
    return
  }
  trajTime += (trajDir * dt) / trajSpec.duration
  if (trajTime >= 1) {
    trajTime = 1
    trajDir = -1
    trajDwell = trajSpec.dwell
  } else if (trajTime <= 0) {
    trajTime = 0
    trajDir = 1
    trajDwell = trajSpec.dwell
  }
}

/** ping-pong s(t) for one profile: hold q₀, forward leg, hold q_f, reverse leg */
function pingPong(prof: TimeScaling, c: number, duration: number, dwell: number): { s: number; v: number } {
  if (c < dwell) return { s: 0, v: 0 }
  if (c < dwell + duration) {
    const smp = prof(c - dwell, duration)
    return { s: smp.s, v: smp.v }
  }
  if (c < 2 * dwell + duration) return { s: 1, v: 0 }
  const smp = prof(2 * (dwell + duration) - c, duration)
  return { s: smp.s, v: -smp.v }
}

function stepTrajectory(now: number): void {
  if (!trajSpec) return
  if (!trajArmed) {
    // hold PID control until the robot(s) reach q₀ (or a 3 s fallback), so
    // entry is a smooth move, not a snap
    const atStart = trajTracks.every((t) =>
      t.joints.every((j) => Math.abs(j.ch.x - j.from) < 0.02 && Math.abs(j.ch.v) < 0.05),
    )
    if (!atStart && (now - trajArmStart) / 1000 < 3) return
    trajArmed = true
    trajT0 = now
    trajLastNow = now
  }
  const taskMode = trajSpec.space === 'task' && trajIk !== null
  if (trajSpec.control === 'slider') {
    // manual scrub: hold at fraction trajS; the path widget sets trajS
    if (taskMode) applyTaskIk(trajS)
    else for (const t of trajTracks) applyTrack(t, trajS, 0)
    return
  }
  if (trajSpec.control === 'time') {
    // transport-driven: one normalized time u feeds every track through its own
    // profile, so the two robots (and the graph marker) stay in lockstep
    const dt = Math.min(Math.max((now - trajLastNow) / 1000, 0), 0.1)
    trajLastNow = now
    if (trajRunning) advanceTime(dt)
    const tReal = trajTime * trajSpec.duration
    if (taskMode) {
      // Lin: one profile maps u→s, then the tool follows the straight line via IK
      applyTaskIk(trajTracks[0].prof(tReal, trajSpec.duration).s)
    } else {
      for (const track of trajTracks) {
        const smp = track.prof(tReal, trajSpec.duration)
        applyTrack(track, smp.s, trajRunning ? smp.v * trajDir : 0)
      }
    }
    return
  }
  // auto: each track maps the shared clock through its own profile, so the two
  // robots diverge mid-move and meet at the ends
  const { duration, dwell } = trajSpec
  const cycle = 2 * (dwell + duration)
  const c = ((now - trajT0) / 1000) % cycle
  trajTracks.forEach((track, i) => {
    const { s, v } = pingPong(track.prof, c, duration, dwell)
    if (i === 0) trajS = s
    applyTrack(track, s, v)
  })
}

const engine = new SlideEngine({
  slides: deck.slides,
  scenes: sceneManager,
  overlay,
  overlayCtx: { createWidget },
  applyCamera: applyCameraSpec,
  applyAnchors,
  applyIdle,
  applyTrajectory,
  onSceneChange: (binding) => rebuildDebugSceneSection(binding),
  onSlideChange: (index) => presenter.setSlide(index),
})

// presenter niceties: overview, help, position indicator, shortcuts (§11)
const presenter = new Presenter(overlayHost, {
  slides: deck.slides,
  goTo: (i) => engine.goTo(i, i < engine.currentIndex ? 'backward' : 'forward'),
  currentIndex: () => engine.currentIndex,
})

window.addEventListener('keydown', (e) => {
  // focused form controls (slide widgets, debug sliders) keep their native
  // keyboard behavior — deck navigation must not hijack a slider mid-lesson
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) {
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // presenter modals + Home/End/o/f/? claim their keys first
  if (presenter.handleKey(e)) {
    e.preventDefault()
    return
  }
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault()
    engine.next()
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault()
    engine.prev()
  } else if (e.key === 'd') {
    panel.classList.toggle('hidden')
  } else if (e.key === 't') {
    logTuning()
  }
})

// per-slide motion tuning aid (§11): dump the live camera spring + PID gains as
// frontmatter YAML so a value tuned in the debug panel can be pasted back into
// slides.md — closing the tune-by-feel loop the debug sliders open
function logTuning(): void {
  const z = (n: number) => Number(n.toFixed(3))
  const lines = [
    `# tuning for slide '${engine.current.id}'`,
    `camera:`,
    `  spring: { omega: ${z(cameraCtl.spring.omega)}, zeta: ${z(cameraCtl.spring.zeta)} }`,
  ]
  const active = sceneManager.active
  if (active) {
    lines.push(`# per-channel PID gains:`)
    for (const [name, ch] of Object.entries(active.channels)) {
      lines.push(`#   ${name}: { kp: ${z(ch.pid.kp)}, ki: ${z(ch.pid.ki)}, kd: ${z(ch.pid.kd)} }`)
    }
  }
  console.log(lines.join('\n'))
}

// deep link: #3 opens slide 3 (works under file://, spec §6)
const parsedHash = Number(window.location.hash.slice(1))
const initialSlide = Number.isInteger(parsedHash) && parsedHash >= 1 ? parsedHash : 1
window.addEventListener('hashchange', () => {
  const n = Number(window.location.hash.slice(1))
  if (Number.isInteger(n) && n >= 1 && n <= engine.slideCount && n - 1 !== engine.currentIndex) {
    // browser Back into a slide is backward navigation: show its end state
    engine.goTo(n - 1, n - 1 < engine.currentIndex ? 'backward' : 'forward')
  }
})

// ---------------------------------------------------------------------------
// Debug panel — hidden by default, toggled with 'd'; scene section rebuilds
// on every scene boundary
// ---------------------------------------------------------------------------

const panel = document.createElement('div')
panel.className = 'panel hidden'

const sceneSection = document.createElement('div')
panel.appendChild(sceneSection)

function heading(parent: HTMLElement, title: string): void {
  const h = document.createElement('h2')
  h.textContent = title
  parent.appendChild(h)
}

function rebuildDebugSceneSection(binding: SceneInstance | null): void {
  sceneSection.replaceChildren()
  if (!binding) {
    heading(sceneSection, 'Scene-less slide — no channels')
    return
  }
  heading(sceneSection, 'Channel setpoints (PID)')
  for (const [name, channel] of Object.entries(binding.channels)) {
    sceneSection.appendChild(
      createSlider({
        label: name,
        min: channel.min,
        max: channel.max,
        value: channel.setpoint,
        format: (v) => `${v.toFixed(2)} rad`,
        onInput: (v) => {
          channel.setpoint = v
          ensureTicking()
        },
      }).el,
    )
  }
  heading(sceneSection, 'PID gains (all channels)')
  const pids = Object.values(binding.channels).map((c) => c.pid)
  const gainDefs: Array<[string, number, number, number, (v: number) => void]> = [
    ['Kp', 0.5, 40, pids[0]?.kp ?? 12, (v) => pids.forEach((p) => (p.kp = v))],
    ['Ki', 0, 20, pids[0]?.ki ?? 0, (v) => pids.forEach((p) => (p.ki = v))],
    ['Kd', 0, 10, pids[0]?.kd ?? 2.5, (v) => pids.forEach((p) => (p.kd = v))],
  ]
  for (const [label, min, max, value, set] of gainDefs) {
    sceneSection.appendChild(
      createSlider({
        label,
        min,
        max,
        value,
        onInput: (v) => {
          set(v)
          ensureTicking()
        },
      }).el,
    )
  }
}

heading(panel, 'Camera spring (ω, ζ)')
panel.appendChild(
  createSlider({
    label: 'ω',
    min: 1,
    max: 12,
    value: cameraCtl.spring.omega,
    onInput: (v) => (cameraCtl.spring.omega = v),
  }).el,
)
panel.appendChild(
  createSlider({
    // ζ < ~0.4 can swing the look point past the camera on large moves
    // (verified in review); real decks spring look-relative if they need more
    label: 'ζ',
    min: 0.4,
    max: 2,
    value: cameraCtl.spring.zeta,
    onInput: (v) => (cameraCtl.spring.zeta = v),
  }).el,
)

const badge = document.createElement('div')
badge.className = 'badge'
panel.appendChild(badge)

document.getElementById('overlay-layer')!.appendChild(panel)

// handle for browser-automation verification and, later, the PDF exporter's settle probe
;(window as unknown as Record<string, unknown>).__lysark = {
  sceneLayer,
  controls,
  motion,
  cameraCtl,
  engine,
  sceneManager,
  anchorLayer,
  overlay,
  presenter,
  stepIdle: (now: number) => stepIdle(now),
  getTrajS: () => trajS,
  ensureTicking: () => ensureTicking(),
  isTicking: () => ticking,
}

// ---------------------------------------------------------------------------
// Frame loop: fixed-timestep motion, then camera, then render. Pausable —
// on a settled scene-less slide the loop stops entirely (spec §3); any
// interaction or transition restarts it.
// ---------------------------------------------------------------------------

let ticking = false
let last = 0

function ensureTicking(): void {
  if (ticking) return
  ticking = true
  last = performance.now()
  requestAnimationFrame(tick)
}

const tick = (now: number) => {
  // idle sweeps setpoints and trajectory playback sets joint state BEFORE the
  // integrator reads them this frame (§11)
  stepIdle(now)
  stepTrajectory(now)
  motion.step((now - last) / 1000)
  last = now

  if (cameraCtl.active) {
    if (cameraTrack) {
      // follow the anchor while joints are still moving (mid-flight re-target)
      const pose = resolveCameraPose(cameraTrack)
      if (pose) cameraCtl.moveTo(pose.position, pose.look, controls.target)
    }
    if (cameraCtl.drive()) {
      // settled this frame — hand the pose back to the orbit camera
      cameraTrack = null
      controls.target.copy(cameraCtl.lookTarget)
      controls.enabled = true
    }
  } else {
    controls.update()
    cameraCtl.syncIdle(controls.target)
  }

  // Ki ≥ Kd·Kp is closed-loop unstable for ẍ = τ (Routh–Hurwitz) — reachable
  // from the gain sliders on purpose; the badge names it instead of hiding it
  const firstPid = sceneManager.active
    ? Object.values(sceneManager.active.channels)[0]?.pid
    : undefined
  const unstable = !!firstPid && firstPid.ki > 0 && firstPid.ki >= firstPid.kd * firstPid.kp
  const settled = motion.settled()
  badge.textContent = unstable ? 'unstable gains: Ki ≥ Kd·Kp' : settled ? 'settled' : 'moving'
  badge.classList.toggle('settled', settled && !unstable)
  badge.classList.toggle('unstable', unstable)

  const sceneVisible = sceneManager.active !== null || sceneManager.busy
  if (sceneVisible) sceneLayer.render()

  // anchored labels: project after render() so matrices are fresh. Reveal on
  // settle — but an idle slide's joints sweep forever and never settle, so on
  // idle slides fall back to camera-settle (spec §4: "camera settle + anchored
  // fade-in"); the label just tracks the still-moving node (§4.2, §5).
  const anchorsRevealed = idleSpecs ? !cameraCtl.active : settled
  anchorLayer.update(sceneLayer.camera, window.innerWidth, window.innerHeight, anchorsRevealed)
  // live plots sample here; t origin is arbitrary (window scrolls relatively)
  overlay.tick(now / 1000)

  // keep ticking while a scene is live (orbiting needs frames); on scene-less
  // slides, stop once everything has settled — zero rAF work at rest (§3)
  if (sceneVisible || cameraCtl.active || !motion.settled(0.5)) {
    requestAnimationFrame(tick)
  } else {
    ticking = false
  }
}

for (const event of ['keydown', 'pointerdown', 'wheel', 'hashchange']) {
  window.addEventListener(event, () => ensureTicking())
}

ensureTicking()
engine.start(initialSlide - 1)
