import './styles.css'
import 'katex/dist/katex.min.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { CameraController } from './scene/camera-controller'
import { buildArmScene } from './scenes/arm'
import { createSlider } from './overlay/widgets/slider'
import { Overlay } from './overlay/overlay'
import { MotionSystem } from './engine/motion-system'
import { SlideEngine } from './engine/slide-engine'
import type { CameraTargetSpec, WidgetSpec } from './engine/slide-types'
import slides from './content/slides.md'

const sceneLayer = new SceneLayer(document.getElementById('scene-layer')!)
const arm = buildArmScene()
sceneLayer.scene.add(arm.root)

const motion = new MotionSystem()
for (const [name, channel] of Object.entries(arm.channels)) {
  motion.add(`${arm.id}.${name}`, channel)
}

const controls = new OrbitControls(sceneLayer.camera, sceneLayer.renderer.domElement)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true

const cameraCtl = new CameraController(sceneLayer.camera, motion, controls.target.clone())

function flyTo(position: THREE.Vector3, look: THREE.Vector3): void {
  if (!cameraCtl.active) {
    // flush frozen orbit damping so residual flick inertia can't replay after
    // the flight; the non-damping update applies and zeroes it in one call.
    // Skipped mid-flight: controls are already disabled and this update()
    // would lookAt the stale pre-flight target, snapping the view.
    controls.enableDamping = false
    controls.update()
    controls.enableDamping = true
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
// Slide deck (M3)
// ---------------------------------------------------------------------------

function resolveCameraPose(spec: CameraTargetSpec): { position: THREE.Vector3; look: THREE.Vector3 } | null {
  let look: THREE.Vector3
  if (typeof spec.lookAt === 'string') {
    const anchor = arm.anchors[spec.lookAt]
    if (!anchor) {
      console.warn(`camera lookAt: unknown anchor '${spec.lookAt}'`)
      return null
    }
    look = anchor.getWorldPosition(new THREE.Vector3())
  } else if (Array.isArray(spec.lookAt)) {
    look = new THREE.Vector3(...spec.lookAt)
  } else {
    look = cameraCtl.lookTarget
  }

  let position: THREE.Vector3
  if (spec.offset) {
    position = look.clone().add(new THREE.Vector3(...spec.offset))
  } else if (spec.distance !== undefined) {
    const dir = sceneLayer.camera.position.clone().sub(look)
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.5, 1)
    position = look.clone().addScaledVector(dir.normalize(), spec.distance)
  } else {
    position = sceneLayer.camera.position.clone()
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

function applyCameraSpec(spec: CameraTargetSpec): void {
  cameraCtl.spring.omega = spec.spring?.omega ?? springDefaults.omega
  cameraCtl.spring.zeta = spec.spring?.zeta ?? springDefaults.zeta
  const pose = resolveCameraPose(spec)
  if (!pose) return
  cameraTrack = typeof spec.lookAt === 'string' ? spec : null
  flyTo(pose.position, pose.look)
}

const overlay = new Overlay(document.getElementById('overlay-layer')!)

function createWidget(spec: WidgetSpec): HTMLElement | null {
  const channel = arm.channels[spec.bind]
  if (!channel) {
    console.warn(`widget bind: unknown channel '${spec.bind}'`)
    return null
  }
  const limits = spec.range ?? [
    arm.jointLimits(spec.bind).lower,
    arm.jointLimits(spec.bind).upper,
  ]
  return createSlider({
    label: spec.label ?? spec.bind,
    min: limits[0],
    max: limits[1],
    value: channel.setpoint,
    format: (v) => `${v.toFixed(2)} rad`,
    onInput: (v) => {
      channel.setpoint = v
    },
  }).el
}

const engine = new SlideEngine({
  slides,
  scene: { channels: arm.channels, defaultGains: arm.defaultGains, defaults: arm.defaults },
  overlay,
  overlayCtx: { createWidget },
  applyCamera: applyCameraSpec,
})

window.addEventListener('keydown', (e) => {
  // focused form controls (slide widgets, debug sliders) keep their native
  // keyboard behavior — deck navigation must not hijack a slider mid-lesson
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) {
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault()
    engine.next()
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault()
    engine.prev()
  } else if (e.key === 'd') {
    panel.classList.toggle('hidden')
  }
})

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
// Debug panel — hidden by default, toggled with 'd'
// ---------------------------------------------------------------------------

const panel = document.createElement('div')
panel.className = 'panel hidden'

function section(title: string): void {
  const h = document.createElement('h2')
  h.textContent = title
  panel.appendChild(h)
}

section('Joint setpoints (PID)')
for (const name of arm.jointNames) {
  const { lower, upper } = arm.jointLimits(name)
  const channel = arm.channels[name]
  const slider = createSlider({
    label: name,
    min: lower,
    max: upper,
    value: channel.x,
    format: (v) => `${v.toFixed(2)} rad`,
    onInput: (v) => {
      channel.setpoint = v
    },
  })
  panel.appendChild(slider.el)
}

section('PID gains (all joints)')
const gainDefs: Array<[label: string, min: number, max: number, value: number, set: (v: number) => void]> = [
  ['Kp', 0.5, 40, 12, (v) => arm.pids.forEach((p) => (p.kp = v))],
  ['Ki', 0, 20, 0, (v) => arm.pids.forEach((p) => (p.ki = v))],
  ['Kd', 0, 10, 2.5, (v) => arm.pids.forEach((p) => (p.kd = v))],
]
for (const [label, min, max, value, set] of gainDefs) {
  panel.appendChild(createSlider({ label, min, max, value, onInput: set }).el)
}

section('Camera spring (ω, ζ)')
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
  arm,
  controls,
  motion,
  cameraCtl,
  engine,
}

// ---------------------------------------------------------------------------
// Frame loop: fixed-timestep motion, then camera, then render
// ---------------------------------------------------------------------------

let last = performance.now()
const tick = (now: number) => {
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
  const { kp, ki, kd } = arm.pids[0]
  const unstable = ki > 0 && ki >= kd * kp
  const settled = motion.settled()
  badge.textContent = unstable
    ? 'unstable gains: Ki ≥ Kd·Kp'
    : settled
      ? 'settled'
      : 'moving'
  badge.classList.toggle('settled', settled && !unstable)
  badge.classList.toggle('unstable', unstable)

  sceneLayer.render()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

engine.start(initialSlide - 1)
