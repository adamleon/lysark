import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneLayer } from '../scene/scene-layer'
import type { MotionSystem } from './motion-system'
import type { ModelLoader, SceneObject } from './object-types'
import { SceneManager } from './scene-manager'
import type { SceneModule } from './scene-types'

// colours come from CSS tokens, which a test has none of
vi.mock('../theme', () => ({ themeColor: () => '#808080' }))

/** a scene layer without a renderer: the scene manager only styles its canvas and asks for frames */
function fakeLayer(): SceneLayer {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color()
  const domElement = { style: {}, toDataURL: () => 'data:,' }
  return { scene, render: () => undefined, renderer: { domElement } } as unknown as SceneLayer
}

const motion = { add: () => undefined, remove: () => undefined } as unknown as MotionSystem
const arm: SceneModule = {
  id: 'arm',
  build: () => ({
    root: new THREE.Group(),
    anchors: {},
    channels: {},
    defaults: { camera: { lookAt: [0, 0, 0], offset: [1, 1, 1] } },
    defaultGains: {},
    serialize: () => null,
    restore: () => undefined,
    dispose: () => undefined,
  }),
}
const bracket: SceneObject = {
  name: 'bracket',
  shape: 'model',
  size: [],
  at: [0, 0, 0],
  rotate: [0, 0, 0],
  model: { src: 'models/bracket.stl', unit: 'm', up: 'y' },
}
const manager = (models?: ModelLoader) => new SceneManager(fakeLayer(), motion, { arm }, {} as HTMLElement, { arm: [bracket] }, models)

describe('SceneManager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("builds a scene's models before its objects, and puts each on its object", async () => {
    vi.stubGlobal('window', globalThis)
    const part = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)))
    const load = vi.fn(async () => new Map([['bracket', part]]))
    const { binding } = await manager({ load }).transitionTo('arm')
    expect(load).toHaveBeenCalledWith([bracket])
    expect(part.parent?.parent).toBe(binding!.anchors.bracket)
    expect(binding!.anchors.bracket.userData.middle).toBeCloseTo(1)
  })

  it('still shows the scene when the models loader rejects, its objects without their models', async () => {
    vi.stubGlobal('window', globalThis)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { binding } = await manager({ load: () => Promise.reject(new Error('out of memory')) }).transitionTo('arm')
    expect(binding!.anchors.bracket.children).toHaveLength(0)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toMatch(/^scene 'arm': its models couldn't be built/)
  })
})
