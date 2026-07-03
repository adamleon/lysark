import * as THREE from 'three'
import type { AnchoredSpec } from '../engine/slide-types'
import { projectToScreen } from './project'

/** the subset of a SceneInstance the anchor layer needs (named 3D nodes) */
export interface AnchorTarget {
  anchors: Record<string, THREE.Object3D>
}

interface AnchorItem {
  spec: AnchoredSpec
  el: HTMLElement
  node?: THREE.Object3D
}

/**
 * Anchor-mode overlay (spec §4.2): DOM labels whose screen position is
 * recomputed each frame by projecting a named 3D node. The text stays DOM
 * (crisp, KaTeX-capable) — never rendered inside WebGL (§4.2). Labels fade in
 * only once the scene has settled, per the choreography contract (§5).
 */
export class AnchorLayer {
  private items: AnchorItem[] = []
  private readonly world = new THREE.Vector3()

  constructor(private readonly host: HTMLElement) {}

  get count(): number {
    return this.items.length
  }

  /** rebuild the labels for a slide; scene = null (scene-less) clears them */
  show(specs: AnchoredSpec[], scene: AnchorTarget | null): void {
    this.clear()
    if (!scene) return
    for (const spec of specs) {
      const el = document.createElement('div')
      el.className = 'anchor-label'
      el.innerHTML = spec.html
      const node = scene.anchors[spec.anchor]
      if (!node) console.warn(`anchored: unknown anchor '${spec.anchor}'`)
      this.host.appendChild(el)
      this.items.push({ spec, el, node })
    }
  }

  clear(): void {
    for (const it of this.items) it.el.remove()
    this.items = []
  }

  /**
   * Per-frame projection + settle-gated reveal (§4.2, §5). Must run after
   * render() so the camera matrices are fresh; `revealed` is motion.settled().
   */
  update(camera: THREE.PerspectiveCamera, width: number, height: number, revealed: boolean): void {
    if (this.items.length === 0) return
    // refresh the inverse once for all labels (render() already updated it,
    // but a paused loop or a resize may have left it stale)
    camera.updateMatrixWorld()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

    for (const { spec, el, node } of this.items) {
      if (!node) {
        el.style.visibility = 'hidden'
        continue
      }
      node.getWorldPosition(this.world)
      const p = projectToScreen(this.world, camera, width, height)
      if (!p.visible) {
        el.style.visibility = 'hidden'
        continue
      }
      el.style.visibility = 'visible'
      el.style.transform = `translate(-50%, -50%) translate(${p.x + spec.offset[0]}px, ${p.y + spec.offset[1]}px)`
      el.classList.toggle('revealed', revealed)
    }
  }
}
