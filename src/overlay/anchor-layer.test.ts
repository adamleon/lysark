import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AnchorLayer, type AnchorTarget } from './anchor-layer'
import type { AnchoredLabelSpec, AnchoredVectorSpec } from '../engine/slide-types'

// The tests run without a DOM; the layer only needs these few parts of an element.
interface FakeElement {
  className: string
  innerHTML: string
  textContent?: string
  style: { visibility?: string; transform?: string }
  classList: { toggle(name: string, on: boolean): void }
  append(...nodes: unknown[]): void
  appendChild(node: unknown): void
  remove(): void
}

function fakeElement(): FakeElement {
  return {
    className: '',
    innerHTML: '',
    style: {},
    classList: { toggle: () => {} },
    append: () => {},
    appendChild: () => {},
    remove: () => {},
  }
}

/** shown: the labels put on the layer; created: every element the layer made (a vector's cells too) */
function setup(): { layer: AnchorLayer; shown: FakeElement[]; created: FakeElement[] } {
  const shown: FakeElement[] = []
  const created: FakeElement[] = []
  const createElement = () => {
    const el = fakeElement()
    created.push(el)
    return el
  }
  vi.stubGlobal('document', { createElement })
  const host = { appendChild: (el: FakeElement) => shown.push(el) }
  return { layer: new AnchorLayer(host as unknown as HTMLElement), shown, created }
}

function label(anchor: string): AnchoredLabelSpec {
  return { kind: 'label', anchor, offset: [0, 0], html: 'x' }
}

function vector(channels: string[]): AnchoredVectorSpec {
  return { kind: 'vector', anchor: 'tool0', offset: [0, 0], symbolHtml: 'q =', channels, digits: 2 }
}

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
  cam.position.set(0, 0, 5)
  cam.lookAt(0, 0, 0)
  return cam
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AnchorLayer', () => {
  const scene: AnchorTarget = { anchors: { tool0: new THREE.Object3D() }, channels: {} }

  it('places a label on a scene anchor', () => {
    const { layer, shown } = setup()
    layer.show([label('tool0')], scene)
    layer.update(camera(), 1920, 1080, true)
    expect(shown[0].style.visibility).toBe('visible')
  })

  it("warns about an anchor name Object.prototype has, and hides the label instead of throwing", () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const { layer, shown } = setup()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      layer.show([label(name)], scene)
      expect(warn).toHaveBeenCalledWith(`anchored: unknown anchor '${name}'`)
      expect(() => layer.update(camera(), 1920, 1080, true)).not.toThrow()
      expect(shown[0].style.visibility).toBe('hidden')
      vi.restoreAllMocks()
    }
  })

  it("shows a live vector's rows from the scene's channels", () => {
    const { layer, created } = setup()
    layer.show([vector(['joint1', 'joint2'])], { anchors: scene.anchors, channels: { joint1: { x: 0.25 }, joint2: { x: -1 } } })
    layer.update(camera(), 1920, 1080, true)
    expect(created.filter((el) => el.className === 'cv-val').map((el) => el.textContent)).toEqual(['\u20070.25', '−1.00'])
  })

  it("warns about a vector row on a channel name Object.prototype has, and shows a dash instead of throwing", () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const { layer, created } = setup()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      layer.show([vector(['joint1', name])], { anchors: scene.anchors, channels: { joint1: { x: 0.25 } } })
      expect(warn).toHaveBeenCalledWith(`anchored vector: unknown channel '${name}'`)
      expect(() => layer.update(camera(), 1920, 1080, true)).not.toThrow()
      expect(created.filter((el) => el.className === 'cv-val').map((el) => el.textContent)).toEqual(['\u20070.25', '—'])
      vi.restoreAllMocks()
    }
  })
})
