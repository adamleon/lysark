import * as THREE from 'three'
import { PID } from '../engine/pid'
import { PidChannel } from '../engine/motion-system'
import type { SceneInstance, SceneModule } from '../engine/scene-types'
import { buildStage, disposeSceneGraph } from './stage'

interface PendulumState {
  swing: { x: number; v: number; setpoint: number }
}

/**
 * Driven pendulum: one 'swing' channel rotating the rod about the pivot.
 * Deliberately underdamped defaults — this scene exists to look different
 * from the arm and to prove the M4 scene lifecycle with a second robot.
 */
function build(): SceneInstance {
  const root = new THREE.Group()
  root.name = 'scene:pendulum'
  root.add(buildStage())

  const graphite = new THREE.MeshStandardMaterial({ color: 0x383c44, roughness: 0.6 })
  const steel = new THREE.MeshStandardMaterial({ color: 0xb2b6bc, roughness: 0.35, metalness: 0.4 })
  const signal = new THREE.MeshStandardMaterial({ color: 0xf28020, roughness: 0.45 })

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 48), graphite)
  base.position.y = 0.04
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), graphite)
  column.position.y = 0.68
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.08), graphite)
  boom.position.set(0.17, 1.24, 0)

  const pivot = new THREE.Group()
  pivot.position.set(0.34, 1.24, 0)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 32), signal)
  hub.rotation.x = Math.PI / 2
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 24), steel)
  rod.position.y = -0.35
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 24), signal)
  bob.position.y = -0.7
  pivot.add(hub, rod, bob)

  root.add(base, column, boom, pivot)
  root.traverse((obj) => {
    obj.castShadow = true
  })

  const defaultGains = { swing: { kp: 9, ki: 0, kd: 0.5 } }
  const channels: Record<string, PidChannel> = {
    swing: new PidChannel({
      x0: 0,
      pid: new PID({ ...defaultGains.swing, outMin: -40, outMax: 40 }),
      min: -2.6,
      max: 2.6,
      apply: (x) => {
        pivot.rotation.z = x
      },
    }),
  }

  return {
    root,
    background: 0x191521,
    anchors: { pivot, bob },
    channels,
    defaults: {
      joints: { swing: 0 },
      camera: { lookAt: [0.34, 0.9, 0], offset: [1.1, 0.15, 1.5] },
    },
    defaultGains,
    serialize(): PendulumState {
      const ch = channels.swing
      return { swing: { x: ch.x, v: ch.v, setpoint: ch.setpoint } }
    },
    restore(state) {
      const s = (state as PendulumState).swing
      const ch = channels.swing
      ch.x = s.x
      ch.v = s.v
      ch.setpoint = s.setpoint
      ch.pid.reset()
      pivot.rotation.z = s.x
    },
    dispose() {
      disposeSceneGraph(root)
    },
  }
}

const pendulum: SceneModule = { id: 'pendulum', build }
export default pendulum
