import './styles.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { CameraController } from './scene/camera-controller'
import { buildArmScene } from './scenes/arm'
import { createSlider } from './overlay/widgets/slider'
import { MotionSystem, PidChannel } from './engine/motion-system'
import { PID } from './engine/pid'

const sceneLayer = new SceneLayer(document.getElementById('scene-layer')!)
const arm = buildArmScene()
sceneLayer.scene.add(arm.root)

// starting pose so the arm isn't a straight vertical stick
arm.setJoint('joint2', 0.6)
arm.setJoint('joint3', -1.0)

const motion = new MotionSystem()

// per-joint PID torque channels; gains shared across joints for the demo panel
const pids: PID[] = []
const jointChannels = new Map<string, PidChannel>()
for (const name of arm.jointNames) {
  const pid = new PID({ kp: 12, ki: 0, kd: 2.5, outMin: -60, outMax: 60 })
  pids.push(pid)
  const { lower, upper } = arm.jointLimits(name)
  const channel = motion.add(
    `joint.${name}`,
    new PidChannel({
      x0: arm.getJoint(name),
      pid,
      min: lower,
      max: upper,
      apply: (x) => arm.setJoint(name, x),
    }),
  )
  jointChannels.set(name, channel)
}

const controls = new OrbitControls(sceneLayer.camera, sceneLayer.renderer.domElement)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true

const cameraCtl = new CameraController(sceneLayer.camera, motion, controls.target.clone())

// ---------------------------------------------------------------------------
// Debug/demo panel (M2) — becomes real overlay content in M3
// ---------------------------------------------------------------------------

const panel = document.createElement('div')
panel.className = 'panel'

function section(title: string): HTMLElement {
  const h = document.createElement('h2')
  h.textContent = title
  panel.appendChild(h)
  return h
}

section('Joint setpoints (PID)')
for (const name of arm.jointNames) {
  const { lower, upper } = arm.jointLimits(name)
  const slider = createSlider({
    label: name,
    min: lower,
    max: upper,
    value: arm.getJoint(name),
    format: (v) => `${v.toFixed(2)} rad`,
    onInput: (v) => {
      jointChannels.get(name)!.setpoint = v
    },
  })
  panel.appendChild(slider.el)
}

section('PID gains (all joints)')
const gainDefs: Array<[label: string, min: number, max: number, value: number, set: (v: number) => void]> = [
  ['Kp', 0.5, 40, 12, (v) => pids.forEach((p) => (p.kp = v))],
  ['Ki', 0, 20, 0, (v) => pids.forEach((p) => (p.ki = v))],
  ['Kd', 0, 10, 2.5, (v) => pids.forEach((p) => (p.kd = v))],
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
    label: 'ζ',
    min: 0.15,
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
  cameraCtl.moveTo(new THREE.Vector3(1.9, 1.2, 1.9), new THREE.Vector3(0, 0.45, 0))
})
poseButton('End effector', () => {
  const ee = new THREE.Vector3()
  arm.robot.links['end_effector'].getWorldPosition(ee)
  cameraCtl.moveTo(ee.clone().add(new THREE.Vector3(0.35, 0.2, 0.45)), ee)
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
  jointChannels,
  cameraCtl,
}

// ---------------------------------------------------------------------------
// Frame loop: fixed-timestep motion, then camera, then render
// ---------------------------------------------------------------------------

let last = performance.now()
const tick = (now: number) => {
  motion.step((now - last) / 1000)
  last = now

  cameraCtl.update(controls.target)
  if (cameraCtl.active) {
    controls.enabled = false
  } else {
    if (!controls.enabled) {
      // hand the settled pose back to the orbit camera
      controls.target.copy(cameraCtl.lookTarget)
      controls.enabled = true
    }
    controls.update()
  }

  const settled = motion.settled()
  badge.textContent = settled ? 'settled' : 'moving'
  badge.classList.toggle('settled', settled)

  sceneLayer.render()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
