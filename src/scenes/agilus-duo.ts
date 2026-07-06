import * as THREE from 'three'
import { PID } from '../engine/pid'
import { PidChannel } from '../engine/motion-system'
import type { GainDefaults, SceneInstance, SceneModule } from '../engine/scene-types'
import { parseAgilusRobot, type AgilusRobot } from './agilus'
import { buildStage, disposeSceneGraph } from './stage'

/**
 * Two overlaid KUKA agilus robots for the time-scaling comparison slide: robot 0
 * runs one profile, robot 1 the other, along the SAME path q₀→q_f on one shared
 * clock — so they diverge mid-move (different s at the same instant) and meet at
 * the ends. One robot is drawn as a translucent ghost; `setSolid` swaps which.
 *
 * Robot 0's joints are channels `joint_1..6`; robot 1's are `ghost_joint_1..6`,
 * so the trajectory's primary `profile` drives robot 0 and `compare` drives
 * robot 1 (main.ts maps `joint_j` → `ghost_joint_j`). One scene, one GPU
 * lifetime (spec §4.1) — the second robot is just two more meshes, no fetch.
 */

interface JointState {
  x: number
  v: number
  setpoint: number
}
export interface AgilusDuoSceneState {
  joints: Record<string, JointState>
}

const GHOST_OPACITY = 0.36
// green tint so the ghost is unmistakable against the white solid robot
const GHOST_COLOR = new THREE.Color(0x3fc46a)
// slightly smaller so, when the two poses coincide, the ghost tucks INSIDE the
// solid (which then occludes it) instead of blending green over the whole robot
const GHOST_SCALE = 0.99

/** make a whole robot solid (its real colours) or a translucent green ghost */
function setRobotGhost(robot: AgilusRobot, ghost: boolean): void {
  robot.scale.setScalar(ghost ? GHOST_SCALE : 1)
  robot.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = !ghost // only the solid robot casts a shadow
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial
      // remember the real colour once so solid mode can restore it exactly
      if (mat.userData.origColor === undefined) {
        mat.userData.origColor = mat.color.clone()
        if (mat.emissive) mat.userData.origEmissive = mat.emissive.clone()
      }
      mat.transparent = ghost
      mat.opacity = ghost ? GHOST_OPACITY : 1
      mat.depthWrite = !ghost
      // push the ghost back in depth so the opaque solid wins wherever they
      // coincide — even at the base, where the 0.99 scale barely separates them
      mat.polygonOffset = ghost
      mat.polygonOffsetFactor = ghost ? 1 : 0
      mat.polygonOffsetUnits = ghost ? 2 : 0
      mat.color.copy(ghost ? GHOST_COLOR : (mat.userData.origColor as THREE.Color))
      if (mat.emissive) {
        // a little self-illumination so the green reads even where unlit
        if (ghost) mat.emissive.copy(GHOST_COLOR).multiplyScalar(0.3)
        else mat.emissive.copy(mat.userData.origEmissive as THREE.Color)
      }
      mat.needsUpdate = true
    }
  })
}

function build(): SceneInstance & { setSolid(index: number): void } {
  const robots: [AgilusRobot, AgilusRobot] = [parseAgilusRobot(), parseAgilusRobot()]
  // a non-degenerate starting pose; the slide's trajectory eases both to q₀
  for (const robot of robots) {
    robot.setJointValue('joint_2', -1.0)
    robot.setJointValue('joint_3', 0.9)
    robot.setJointValue('joint_5', 0.9)
  }

  const root = new THREE.Group()
  root.name = 'scene:agilus-duo'
  root.add(robots[0], robots[1], buildStage())

  const jointNames = Object.keys(robots[0].joints).filter(
    (name) => robots[0].joints[name].jointType !== 'fixed',
  )

  const channels: Record<string, PidChannel> = {}
  const defaultGains: Record<string, GainDefaults> = {}
  const makeChannel = (robot: AgilusRobot, key: string, jointName: string): void => {
    defaultGains[key] = { kp: 12, ki: 0, kd: 7 }
    const joint = robot.joints[jointName]
    channels[key] = new PidChannel({
      x0: Number(joint.angle),
      pid: new PID({ ...defaultGains[key], outMin: -60, outMax: 60 }),
      min: Number(joint.limit.lower),
      max: Number(joint.limit.upper),
      apply: (x) => robot.setJointValue(jointName, x),
    })
  }
  for (const name of jointNames) {
    makeChannel(robots[0], name, name)
    makeChannel(robots[1], `ghost_${name}`, name)
  }

  let solidIndex = 0
  const setSolid = (index: number): void => {
    solidIndex = index === 1 ? 1 : 0
    setRobotGhost(robots[0], solidIndex !== 0)
    setRobotGhost(robots[1], solidIndex !== 1)
  }
  setSolid(0) // robot 0 solid, robot 1 ghost by default

  return {
    root,
    background: 0x17161b,
    anchors: {
      base: robots[0].links['base_link'],
      tool0: robots[0].links['tool0'],
    },
    channels,
    defaults: {
      joints: {},
      camera: { lookAt: [0, 0.55, 0], offset: [0.6, 1.5, 3.4] },
    },
    defaultGains,
    setSolid,
    serialize(): AgilusDuoSceneState {
      const joints: Record<string, JointState> = {}
      for (const [name, ch] of Object.entries(channels)) {
        joints[name] = { x: ch.x, v: ch.v, setpoint: ch.setpoint }
      }
      return { joints }
    },
    restore(state) {
      for (const [name, s] of Object.entries((state as AgilusDuoSceneState).joints)) {
        const ch = channels[name]
        if (!ch) continue
        ch.x = s.x
        ch.v = s.v
        ch.setpoint = s.setpoint
        ch.pid.reset()
      }
      // re-apply the restored angles to both meshes
      for (const name of jointNames) {
        robots[0].setJointValue(name, channels[name]?.x ?? 0)
        robots[1].setJointValue(name, channels[`ghost_${name}`]?.x ?? 0)
      }
    },
    dispose() {
      disposeSceneGraph(root)
    },
  }
}

const agilusDuo: SceneModule = { id: 'agilus-duo', build }
export default agilusDuo
