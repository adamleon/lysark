import './styles.css'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneLayer } from './scene/scene-layer'
import { buildArmScene } from './scenes/arm'
import { createSlider } from './overlay/widgets/slider'

const sceneLayer = new SceneLayer(document.getElementById('scene-layer')!)
const arm = buildArmScene()
sceneLayer.scene.add(arm.root)

// starting pose so the arm isn't a straight vertical stick
arm.setJoint('joint2', 0.6)
arm.setJoint('joint3', -1.0)

// M1: orbit debug camera; the spring-damper CameraController replaces this path in M2
const controls = new OrbitControls(sceneLayer.camera, sceneLayer.renderer.domElement)
controls.target.set(0, 0.45, 0)
controls.enableDamping = true

// M1 debug panel: sliders drive joints directly (PID arrives in M2)
const panel = document.createElement('div')
panel.className = 'panel'
const heading = document.createElement('h2')
heading.textContent = 'Joints — direct (M1)'
panel.appendChild(heading)

for (const name of arm.jointNames) {
  const { lower, upper } = arm.jointLimits(name)
  const slider = createSlider({
    label: name,
    min: lower,
    max: upper,
    value: arm.getJoint(name),
    format: (v) => `${v.toFixed(2)} rad`,
    onInput: (v) => arm.setJoint(name, v),
  })
  panel.appendChild(slider.el)
}
document.getElementById('overlay-layer')!.appendChild(panel)

// handle for browser-automation verification and, later, the PDF exporter's settle probe
;(window as unknown as Record<string, unknown>).__lysark = { sceneLayer, arm, controls }

const tick = () => {
  controls.update()
  sceneLayer.render()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
