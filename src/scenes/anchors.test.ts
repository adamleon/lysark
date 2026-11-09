import { describe, expect, it } from 'vitest'
import agilusSource from './agilus.ts?raw'
import agilusDuoSource from './agilus-duo.ts?raw'
import armSource from './arm.ts?raw'
import pendulumSource from './pendulum.ts?raw'
import { SCENE_ANCHORS } from './anchors'
import { SCENE_NAMES } from './registry'

/** the names in a scene's `anchors: { … }` */
function anchorsIn(source: string): string[] {
  const block = /\banchors: \{([^}]*)\}/.exec(source)
  if (!block) throw new Error("no 'anchors: { … }' in the scene's source")
  return block[1]
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter((name) => name !== '')
}

describe('SCENE_ANCHORS', () => {
  it('has every scene', () => {
    expect(Object.keys(SCENE_ANCHORS).sort()).toEqual([...SCENE_NAMES].sort())
  })

  it("agrees with the scenes' anchors", () => {
    expect(SCENE_ANCHORS.arm.anchors).toEqual(anchorsIn(armSource))
    expect(SCENE_ANCHORS.pendulum.anchors).toEqual(anchorsIn(pendulumSource))
    expect(SCENE_ANCHORS.agilus.anchors).toEqual(anchorsIn(agilusSource))
    expect(SCENE_ANCHORS['agilus-duo'].anchors).toEqual(anchorsIn(agilusDuoSource))
  })

  it('lets objects hang only on anchors the scene has', () => {
    for (const { anchors, parents } of Object.values(SCENE_ANCHORS)) {
      for (const parent of parents) expect(anchors).toContain(parent)
    }
  })
})
