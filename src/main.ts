import './styles.css'
import 'katex/dist/katex.min.css'
import 'uplot/dist/uPlot.min.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { CameraController } from './scene/camera-controller'
import { createSlider } from './overlay/widgets/slider'
import { createPlot } from './overlay/widgets/plot'
import { Overlay, type WidgetHandle } from './overlay/overlay'
import { AnchorLayer } from './overlay/anchor-layer'
import { Presenter } from './overlay/presenter'
import { MotionSystem, type PidChannel } from './engine/motion-system'
import { SceneManager } from './engine/scene-manager'
import { SlideEngine } from './engine/slide-engine'
import { parseBinding, readField } from './engine/channel-binding'
import type { SceneInstance } from './engine/scene-types'
import type { CameraTargetSpec, CompiledSlide, WidgetSpec } from './engine/slide-types'
import deck from './content/deck'

const sceneLayer = new SceneLayer(document.getElementById('scene-layer')!)
const motion = new MotionSystem()
const sceneManager = new SceneManager(
  sceneLayer,
  motion,
  deck.scenes,
  document.getElementById('scene-layer')!,
)

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

const engine = new SlideEngine({
  slides: deck.slides,
  scenes: sceneManager,
  overlay,
  overlayCtx: { createWidget },
  applyCamera: applyCameraSpec,
  applyAnchors,
  applyIdle,
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
  // idle sweeps setpoints BEFORE the integrator reads them this frame (§11)
  stepIdle(now)
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
