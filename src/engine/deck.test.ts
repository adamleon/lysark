import { describe, expect, it } from 'vitest'
import { defineDeck } from './deck'
import type { ModelLoader, SceneObject } from './object-types'
import type { SceneModule } from './scene-types'

const scene: SceneModule = { id: 'arm', build: () => Promise.reject(new Error('not built here')) }
const object = (name: string, shape: SceneObject['shape']): SceneObject => ({ name, shape, size: [], at: [0, 0, 0], rotate: [0, 0, 0] })
const loader: ModelLoader = { load: async () => new Map() }

describe('defineDeck', () => {
  it('needs a model loader for a deck whose objects have models', () => {
    const objects = { arm: [object('table', 'box'), object('bracket', 'model')] }
    expect(() => defineDeck({ scenes: { arm: scene }, slides: [], objects })).toThrow(
      "deck: object 'bracket' has a model, but the deck has no model loader",
    )
    expect(defineDeck({ scenes: { arm: scene }, slides: [], objects, models: loader }).models).toBe(loader)
    // a lecture without models has no loader, and needs none
    expect(() => defineDeck({ scenes: { arm: scene }, slides: [], objects: { arm: [object('table', 'box')] } })).not.toThrow()
  })
})
