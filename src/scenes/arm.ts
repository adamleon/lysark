import * as THREE from 'three'
import URDFLoader from 'urdf-loader'
import urdfSrc from '../assets/arm.urdf?raw'

export type ArmRobot = ReturnType<URDFLoader['parse']>

export interface ArmScene {
  root: THREE.Object3D
  robot: ArmRobot
  jointNames: string[]
  jointLimits(name: string): { lower: number; upper: number }
  setJoint(name: string, value: number): void
  getJoint(name: string): number
}

export function buildArmScene(): ArmScene {
  // parse(), never load() — the load() path fetches and dies under file:// (spec §9b)
  const robot = new URDFLoader().parse(urdfSrc)

  // URDF is Z-up, three.js is Y-up
  robot.rotation.x = -Math.PI / 2
  robot.traverse((obj) => {
    obj.castShadow = true
  })

  const jointNames = Object.keys(robot.joints).filter(
    (name) => robot.joints[name].jointType !== 'fixed',
  )

  return {
    root: robot,
    robot,
    jointNames,
    jointLimits(name) {
      const joint = robot.joints[name]
      return { lower: Number(joint.limit.lower), upper: Number(joint.limit.upper) }
    },
    setJoint(name, value) {
      robot.setJointValue(name, value)
    },
    getJoint(name) {
      return Number(robot.joints[name].angle)
    },
  }
}
