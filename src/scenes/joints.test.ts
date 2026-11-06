import { describe, expect, it } from 'vitest'
import agilusUrdf from '../assets/agilus/kr6_r900_2.urdf?raw'
import armUrdf from '../assets/arm.urdf?raw'
import pendulumSource from './pendulum.ts?raw'
import { SCENE_JOINTS } from './joints'
import { SCENE_NAMES } from './registry'

/** the moving joints of a URDF file, in order, with their limits */
function urdfJoints(text: string) {
  const out: Array<{ name: string; min: number; max: number }> = []
  for (const m of text.matchAll(/<joint\s+name="([^"]+)"\s+type="([^"]+)"[\s\S]*?<\/joint>/g)) {
    if (m[2] === 'fixed') continue
    const limit = /<limit\b[^>]*>/.exec(m[0])![0]
    const attr = (name: string) => Number(new RegExp(`${name}="([^"]+)"`).exec(limit)![1])
    out.push({ name: m[1], min: attr('lower'), max: attr('upper') })
  }
  return out
}

describe('SCENE_JOINTS', () => {
  it('has every scene', () => {
    expect(Object.keys(SCENE_JOINTS).sort()).toEqual([...SCENE_NAMES].sort())
  })

  it("agrees with the robots' URDF files", () => {
    expect(SCENE_JOINTS.arm).toEqual(urdfJoints(armUrdf))
    expect(SCENE_JOINTS.agilus).toEqual(urdfJoints(agilusUrdf))
    expect(SCENE_JOINTS['agilus-duo']).toEqual(SCENE_JOINTS.agilus)
  })

  it("agrees with the pendulum scene's constants", () => {
    const swing = /swing: new PidChannel\(\{[\s\S]*?min: (-?[\d.]+),\s*max: (-?[\d.]+)/.exec(pendulumSource)!
    expect(SCENE_JOINTS.pendulum).toEqual([{ name: 'swing', min: Number(swing[1]), max: Number(swing[2]) }])
  })
})
