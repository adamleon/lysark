import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import urdfSrc from '../assets/agilus/kr6_r900_2.urdf?raw'
import baseLinkDae from '../assets/agilus/base_link.dae?raw'
import link1Dae from '../assets/agilus/link_1.dae?raw'
import link2Dae from '../assets/agilus/link_2.dae?raw'
import link3Dae from '../assets/agilus/link_3.dae?raw'
import link4Dae from '../assets/agilus/link_4.dae?raw'
import link5Dae from '../assets/agilus/link_5.dae?raw'
import link6Dae from '../assets/agilus/link_6.dae?raw'
import { PID } from '../engine/pid'
import { PidChannel } from '../engine/motion-system'
import type { GainDefaults, SceneInstance, SceneModule } from '../engine/scene-types'
import { createIkSolver, type IkSolver } from '../scene/ik'
import { buildStage, disposeSceneGraph } from './stage'

// visual meshes are Collada XML text (imported ?raw), keyed by basename so the
// URDF's `../meshes/.../link_1.dae` references resolve from memory — no fetch,
// so this works identically in dev, classroom, and the file:// offline build (§9b)
const DAE_BY_NAME: Record<string, string> = {
  'base_link.dae': baseLinkDae,
  'link_1.dae': link1Dae,
  'link_2.dae': link2Dae,
  'link_3.dae': link3Dae,
  'link_4.dae': link4Dae,
  'link_5.dae': link5Dae,
  'link_6.dae': link6Dae,
}

interface JointState {
  x: number
  v: number
  setpoint: number
}
export interface AgilusSceneState {
  joints: Record<string, JointState>
}

// urdf-loader's real loadMeshCb signature is (path, manager, material, onComplete)
// — the shipped .d.ts drops the `material` arg, so we retype it locally to avoid
// binding onComplete to the wrong parameter (that crash is silent: the scene just
// fails to build)
type MeshCb = (
  path: string,
  manager: THREE.LoadingManager,
  material: THREE.Material,
  onComplete: (mesh: THREE.Object3D | null, err?: Error) => void,
) => void

export type AgilusRobot = ReturnType<URDFLoader['parse']>

/**
 * Parse one KUKA agilus from the embedded URDF + Collada meshes (no fetch —
 * file://-safe, spec §9b), Y-up, with creased normals + shadows. Shared by the
 * single-robot `agilus` scene and the two-robot `agilus-duo` comparison scene.
 */
export function parseAgilusRobot(): AgilusRobot {
  const loader = new URDFLoader()
  // parse() + custom loadMeshCb — never load(), which fetches (dies under file://)
  ;(loader as unknown as { loadMeshCb: MeshCb }).loadMeshCb = (path, manager, _material, onComplete) => {
    const name = path.split(/[\\/]/).pop() ?? path
    const text = DAE_BY_NAME[name]
    if (!text) {
      onComplete(null, new Error(`agilus: no embedded mesh '${name}'`))
      return
    }
    // pass collada.scene straight through, exactly as urdf-loader's default DAE
    // loader does — ColladaLoader's own Z_UP→Y-up handling already matches how
    // urdf-loader places the mesh in the (Z-up) link frame; an extra rotation
    // here mis-aligns the links (they separate at extended poses)
    const collada = new ColladaLoader(manager).parse(text, '')
    if (!collada) {
      onComplete(null, new Error(`agilus: failed to parse '${name}'`))
      return
    }
    onComplete(collada.scene)
  }

  const robot = loader.parse(urdfSrc)

  // URDF is Z-up, three.js is Y-up
  robot.rotation.x = -Math.PI / 2
  robot.traverse((obj) => {
    obj.castShadow = true
    obj.receiveShadow = true
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      // the Collada meshes ship non-indexed with per-face (flat) normals, so
      // curved castings look faceted; recompute creased normals — smooth across
      // shallow angles, sharp above 40° — so cylinders shade smoothly but real
      // edges stay crisp
      mesh.geometry = toCreasedNormals(mesh.geometry, THREE.MathUtils.degToRad(40))
    }
  })
  return robot
}

function build(): SceneInstance & { ik: IkSolver } {
  const robot = parseAgilusRobot()

  // a raised, reaching pose so the arm clearly rises off the base (not folded
  // forward, which reads flat against the dark ground)
  robot.setJointValue('joint_2', -1.25)
  robot.setJointValue('joint_3', 0.9)
  robot.setJointValue('joint_5', 0.9)

  const root = new THREE.Group()
  root.name = 'scene:agilus'
  root.add(robot, buildStage())

  const jointNames = Object.keys(robot.joints).filter(
    (name) => robot.joints[name].jointType !== 'fixed',
  )

  const channels: Record<string, PidChannel> = {}
  const defaultGains: Record<string, GainDefaults> = {}
  for (const name of jointNames) {
    // critically damped by default (ζ ≈ 1 on a unit-inertia joint: kd ≈ 2√kp):
    // a robot at rest shouldn't wobble. Slides that want to teach overshoot
    // (the demo's agilus-joint) still do so with explicit per-widget gain overrides.
    defaultGains[name] = { kp: 12, ki: 0, kd: 7 }
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
      base: robot.links['base_link'],
      tool0: robot.links['tool0'],
    },
    channels,
    // exposed for the Lin/MoveL slide: task-space straight-line IK on tool0
    ik: createIkSolver(robot, jointNames, 'tool0'),
    defaults: {
      joints: { joint_2: -1.25, joint_3: 0.9, joint_5: 0.9 },
      camera: { lookAt: [0.2, 0.55, 0], offset: [1.7, 0.35, 2.3] },
    },
    defaultGains,
    serialize(): AgilusSceneState {
      const joints: Record<string, JointState> = {}
      for (const [name, ch] of Object.entries(channels)) {
        joints[name] = { x: ch.x, v: ch.v, setpoint: ch.setpoint }
      }
      return { joints }
    },
    restore(state) {
      for (const [name, s] of Object.entries((state as AgilusSceneState).joints)) {
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

const agilus: SceneModule = { id: 'agilus', build }
export default agilus
