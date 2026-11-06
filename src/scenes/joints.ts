import type { SCENE_NAMES } from './registry'

/**
 * Each engine scene's joints, in order, with their limits in radians, for the
 * compiler: a named pose written as a list (`q0: [...]`) sets them in this
 * order, and the build checks its values against the limits
 * (docs/scene-files.md). The scenes themselves take the same from their URDF
 * files or constants; joints.test.ts checks that this table agrees. The
 * compiler can't import the scenes: they bring three.js and the meshes.
 */
export interface JointInfo {
  name: string
  min: number
  max: number
}

// src/assets/agilus/kr6_r900_2.urdf
const KR6: JointInfo[] = [
  { name: 'joint_1', min: -2.967059725, max: 2.967059725 },
  { name: 'joint_2', min: -3.316125575, max: 0.7853981625 },
  { name: 'joint_3', min: -2.0943951, max: 2.72271363 },
  { name: 'joint_4', min: -3.2288591125, max: 3.2288591125 },
  { name: 'joint_5', min: -2.0943951, max: 2.0943951 },
  { name: 'joint_6', min: -6.108652375, max: 6.108652375 },
]

export const SCENE_JOINTS: Record<(typeof SCENE_NAMES)[number], JointInfo[]> = {
  // src/assets/arm.urdf
  arm: [
    { name: 'joint1', min: -3.1416, max: 3.1416 },
    { name: 'joint2', min: -1.9, max: 1.9 },
    { name: 'joint3', min: -2.4, max: 2.4 },
  ],
  // src/scenes/pendulum.ts
  pendulum: [{ name: 'swing', min: -2.6, max: 2.6 }],
  agilus: KR6,
  // the robot; its ghost's joints (ghost_joint_*) follow a trajectory's comparison
  'agilus-duo': KR6,
}
