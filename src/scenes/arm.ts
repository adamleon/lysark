import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import urdfSrc from '../assets/arm.urdf?raw'
import { PID } from '../engine/pid'
import { PidChannel } from '../engine/motion-system'
import type { SlideTargets } from '../engine/slide-types'
import type { GainDefaults } from '../engine/slide-engine'

export type ArmRobot = ReturnType<URDFLoader['parse']>

export interface JointState {
  x: number
  v: number
  setpoint: number
}

export interface ArmSceneState {
  joints: Record<string, JointState>
}

/**
 * Scene-module shape per spec §7: the module owns its graph (including
 * lights/ground — the persistent SceneLayer owns none of the world), its
 * anchors, its motion channels, and its serialize/restore/dispose contract.
 */
export interface ArmScene {
  id: string
  root: THREE.Object3D
  robot: ArmRobot
  anchors: Record<string, THREE.Object3D>
  channels: Record<string, PidChannel>
  pids: PID[]
  /** effective-target base for slide 1 of the scene's range (spec §4.3/§7) */
  defaults: SlideTargets
  defaultGains: Record<string, GainDefaults>
  jointNames: string[]
  jointLimits(name: string): { lower: number; upper: number }
  serialize(): ArmSceneState
  restore(state: ArmSceneState): void
  dispose(): void
}

export function buildArmScene(): ArmScene {
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
  root.add(robot)

  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x30343a, 0.9)
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(2.5, 4, 1.5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 12
  key.shadow.camera.left = -3
  key.shadow.camera.right = 3
  key.shadow.camera.top = 3
  key.shadow.camera.bottom = -3
  key.shadow.bias = -0.0002
  key.shadow.normalBias = 0.02
  root.add(hemi, key)

  const grid = new THREE.GridHelper(5, 25, 0x3a4048, 0x272c33)
  root.add(grid)

  // shadow catcher just below the grid to avoid z-fighting
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.001
  ground.receiveShadow = true
  root.add(ground)

  const jointNames = Object.keys(robot.joints).filter(
    (name) => robot.joints[name].jointType !== 'fixed',
  )

  const pids: PID[] = []
  const channels: Record<string, PidChannel> = {}
  const defaultGains: Record<string, GainDefaults> = {}
  for (const name of jointNames) {
    defaultGains[name] = { kp: 12, ki: 0, kd: 2.5 }
    const pid = new PID({ ...defaultGains[name], outMin: -60, outMax: 60 })
    pids.push(pid)
    const joint = robot.joints[name]
    channels[name] = new PidChannel({
      x0: Number(joint.angle),
      pid,
      min: Number(joint.limit.lower),
      max: Number(joint.limit.upper),
      apply: (x) => robot.setJointValue(name, x),
    })
  }

  return {
    id: 'arm',
    root,
    robot,
    anchors: {
      base: robot,
      end_effector: robot.links['end_effector'],
    },
    channels,
    pids,
    defaults: {
      joints: { joint1: 0, joint2: 0.6, joint3: -1.0 },
      camera: { lookAt: [0, 0.45, 0], offset: [1.4, 0.65, 1.4] },
    },
    defaultGains,
    jointNames,
    jointLimits(name) {
      const joint = robot.joints[name]
      return { lower: Number(joint.limit.lower), upper: Number(joint.limit.upper) }
    },
    serialize() {
      const joints: Record<string, JointState> = {}
      for (const [name, ch] of Object.entries(channels)) {
        joints[name] = { x: ch.x, v: ch.v, setpoint: ch.setpoint }
      }
      return { joints }
    },
    restore(state) {
      for (const [name, s] of Object.entries(state.joints)) {
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
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh || (obj as THREE.LineSegments).isLineSegments) {
          mesh.geometry?.dispose()
          const material = mesh.material
          if (Array.isArray(material)) material.forEach((m) => m.dispose())
          else material?.dispose()
        }
        const light = obj as THREE.DirectionalLight
        if (light.isLight && light.shadow) light.shadow.dispose()
      })
    },
  }
}
