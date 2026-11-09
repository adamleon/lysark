import * as THREE from 'three'

/**
 * For tests only: a robot shaped like src/assets/arm.urdf (a turn about z at
 * the base, two hinges about y, the tool above them), built by hand, as the
 * URDF loader needs a DOM. `wrist`: one more joint, 'roll' whose axis runs
 * through the tool (as the KUKA's joint_6), or 'pitch', a hinge that makes the
 * arm redundant for where the tool is (as the KUKA's wrist does).
 */
export function armChain(wrist: 'none' | 'roll' | 'pitch' = 'none') {
  const root = new THREE.Object3D()
  const joint = (parent: THREE.Object3D, axis: [number, number, number], z: number, lower: number, upper: number) => {
    const j = Object.assign(new THREE.Object3D(), { axis: new THREE.Vector3(...axis), angle: 0, limit: { lower, upper } })
    j.position.set(0, 0, z)
    parent.add(j)
    return j
  }
  const joint1 = joint(root, [0, 0, 1], 0.06, -3.1416, 3.1416)
  const joint2 = joint(joint1, [0, 1, 0], 0.11, -1.9, 1.9)
  const joint3 = joint(joint2, [0, 1, 0], 0.32, -2.4, 2.4)
  const joints: Record<string, ReturnType<typeof joint>> = { joint1, joint2, joint3 }
  let last = joint3
  if (wrist !== 'none') {
    joints.joint4 = joint(joint3, wrist === 'roll' ? [0, 0, 1] : [0, 1, 0], 0.2, -2.4, 2.4)
    last = joints.joint4
  }
  const tool = new THREE.Object3D()
  tool.position.set(0, 0, wrist !== 'none' ? 0.08 : 0.28)
  last.add(tool)
  return Object.assign(root, {
    joints,
    links: { tool },
    setJointValue(name: string, value: number) {
      const j = joints[name]
      j.angle = value
      j.quaternion.setFromAxisAngle(j.axis, value)
    },
  })
}
