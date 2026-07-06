import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import urdfSrc from '../assets/arm.urdf?raw'
import { PID } from '../engine/pid'
import { PidChannel } from '../engine/motion-system'
import type { GainDefaults, SceneInstance, SceneModule } from '../engine/scene-types'
import { buildStage, disposeSceneGraph } from './stage'

export type ArmRobot = ReturnType<URDFLoader['parse']>

interface JointState {
  x: number
  v: number
  setpoint: number
}

export interface ArmSceneState {
  joints: Record<string, JointState>
}

function build(): SceneInstance {
  // parse(), never load() — the load() path fetches and dies under file:// (spec §9b)
  const robot = new URDFLoader().parse(urdfSrc)

  // URDF is Z-up, three.js is Y-up
  robot.rotation.x = -Math.PI / 2
  robot.traverse((obj) => {
    obj.castShadow = true
  })

  // starting pose before channels capture x0
  robot.setJointValue('joint2', 0.6)
  robot.setJointValue('joint3', -1.0)

  const root = new THREE.Group()
  root.name = 'scene:arm'
  root.add(robot, buildStage())

  const jointNames = Object.keys(robot.joints).filter(
    (name) => robot.joints[name].jointType !== 'fixed',
  )

  const channels: Record<string, PidChannel> = {}
  const defaultGains: Record<string, GainDefaults> = {}
  for (const name of jointNames) {
    defaultGains[name] = { kp: 12, ki: 0, kd: 2.5 }
    const joint = robot.joints[name]
    channels[name] = new PidChannel({
      x0: Number(joint.angle),
      pid: new PID({ ...defaultGains[name], outMin: -60, outMax: 60 }),
      min: Number(joint.limit.lower),
      max: Number(joint.limit.upper),
      apply: (x) => robot.setJointValue(name, x),
    })
  }

  return {
    root,
    background: 0x17161b,
    anchors: {
      base: robot,
      end_effector: robot.links['end_effector'],
    },
    channels,
    defaults: {
      joints: { joint1: 0, joint2: 0.6, joint3: -1.0 },
      camera: { lookAt: [0, 0.45, 0], offset: [1.4, 0.65, 1.4] },
    },
    defaultGains,
    serialize(): ArmSceneState {
      const joints: Record<string, JointState> = {}
      for (const [name, ch] of Object.entries(channels)) {
        joints[name] = { x: ch.x, v: ch.v, setpoint: ch.setpoint }
      }
      return { joints }
    },
    restore(state) {
      for (const [name, s] of Object.entries((state as ArmSceneState).joints)) {
        const ch = channels[name]
        if (!ch) continue
        ch.x = s.x
        ch.v = s.v
        ch.setpoint = s.setpoint
        ch.pid.reset()
        robot.setJointValue(name, s.x)
      }
    },
    dispose() {
      disposeSceneGraph(root)
    },
  }
}

const arm: SceneModule = { id: 'arm', build }
export default arm
