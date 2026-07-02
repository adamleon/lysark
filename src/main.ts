import './styles.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { CameraController } from './scene/camera-controller'
import { buildArmScene } from './scenes/arm'
import { createSlider } from './overlay/widgets/slider'
import { MotionSystem } from './engine/motion-system'

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
  // flush frozen orbit damping so residual flick inertia can't replay after
  // the flight; the non-damping update applies and zeroes it in one call
  controls.enableDamping = false
  controls.update()
  controls.enableDamping = true
  controls.enabled = false
  cameraCtl.moveTo(position, look, controls.target)
}

// clicking the scene cancels an active flight instead of locking input out
sceneLayer.renderer.domElement.addEventListener('pointerdown', () => {
  if (!cameraCtl.active) return
  cameraCtl.cancel()
  controls.target.copy(cameraCtl.lookTarget)
  controls.enabled = true
})

// ---------------------------------------------------------------------------
// Debug/demo panel (M2) — becomes real overlay content in M3
// ---------------------------------------------------------------------------

const panel = document.createElement('div')
panel.className = 'panel'

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

const buttonRow = document.createElement('div')
buttonRow.className = 'button-row'
function poseButton(label: string, go: () => void): void {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', go)
  buttonRow.appendChild(b)
}
poseButton('Overview', () => {
  flyTo(new THREE.Vector3(1.9, 1.2, 1.9), new THREE.Vector3(0, 0.45, 0))
})
poseButton('End effector', () => {
  const ee = new THREE.Vector3()
  arm.anchors.end_effector.getWorldPosition(ee)
  flyTo(ee.clone().add(new THREE.Vector3(0.35, 0.2, 0.45)), ee)
})
panel.appendChild(buttonRow)

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
}

// ---------------------------------------------------------------------------
// Frame loop: fixed-timestep motion, then camera, then render
// ---------------------------------------------------------------------------

let last = performance.now()
const tick = (now: number) => {
  motion.step((now - last) / 1000)
  last = now

  if (cameraCtl.active) {
    if (cameraCtl.drive()) {
      // settled this frame — hand the pose back to the orbit camera
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
