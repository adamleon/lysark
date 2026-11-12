import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AnchorLayer, type AnchorTarget } from './anchor-layer'
import type { AnchoredLabelSpec } from '../engine/slide-types'

// The tests run without a DOM; the layer only needs these few parts of an element.
interface FakeElement {
  className: string
  innerHTML: string
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

function setup(): { layer: AnchorLayer; shown: FakeElement[] } {
  const shown: FakeElement[] = []
  vi.stubGlobal('document', { createElement: fakeElement })
  const host = { appendChild: (el: FakeElement) => shown.push(el) }
  return { layer: new AnchorLayer(host as unknown as HTMLElement), shown }
}

function label(anchor: string): AnchoredLabelSpec {
  return { kind: 'label', anchor, offset: [0, 0], html: 'x' }
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
})
