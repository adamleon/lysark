import { describe, expect, it } from 'vitest'
import { ALL_SCENES } from './all'
import { SCENE_NAMES } from './registry'

describe('scene lists', () => {
  it('ALL_SCENES matches the registry, and each key is the module id', () => {
    expect(Object.keys(ALL_SCENES).sort()).toEqual([...SCENE_NAMES].sort())
    for (const [name, module] of Object.entries(ALL_SCENES)) expect(module.id).toBe(name)
  })
})
