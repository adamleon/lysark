import * as THREE from 'three'
import type { AnchoredSpec, AnchoredVectorSpec } from '../engine/slide-types'
import { projectToScreen } from './project'

/** the subset of a SceneInstance the anchor layer needs: named nodes + live channels */
export interface AnchorTarget {
  anchors: Record<string, THREE.Object3D>
  channels: Record<string, { x: number }>
}

/** one live row of a configuration vector: the cell element and its channel */
interface LiveRow {
  el: HTMLElement
  channel?: { x: number }
  digits: number
}

interface AnchorItem {
  spec: AnchoredSpec
  el: HTMLElement
  node?: THREE.Object3D
  /** fade-in latches once true — a live vector must not blink out mid-drag (§5) */
  revealed: boolean
  /** present only for vector items; refreshed every frame */
  live?: LiveRow[]
}

/**
 * Format a value with a fixed-width sign slot (figure space for '+') so a live
 * vector's bracket doesn't jitter as entries cross zero. Paired with
 * tabular-nums + a min-width in CSS, every row stays the same width.
 */
function formatSigned(x: number, digits: number): string {
  // sign from the ROUNDED value so a tiny negative residue prints " 0.00", not "-0.00"
  const r = Number(x.toFixed(digits))
  return (r < 0 ?'−' : ' ') + Math.abs(x).toFixed(digits)
}

/**
 * Anchor-mode overlay (spec §4.2): DOM labels whose screen position is
 * recomputed each frame by projecting a named 3D node. The text stays DOM
 * (crisp, KaTeX-capable) — never rendered inside WebGL (§4.2). Labels fade in
 * only once the scene has settled, per the choreography contract (§5).
 *
 * Two kinds: a static `label` (pre-rendered HTML) and a live `vector` whose rows
 * show the current measured value of named channels, refreshed every frame.
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
      const node = scene.anchors[spec.anchor]
      if (!node) console.warn(`anchored: unknown anchor '${spec.anchor}'`)
      const el = document.createElement('div')
      let live: LiveRow[] | undefined
      if (spec.kind === 'vector') {
        el.className = 'anchor-label anchor-vector'
        live = this.buildVector(el, spec, scene)
      } else {
        el.className = 'anchor-label'
        el.innerHTML = spec.html
      }
      this.host.appendChild(el)
      this.items.push({ spec, el, node, revealed: false, live })
    }
  }

  /** build the "symbol = [ … ]" scaffolding once; update() fills the rows */
  private buildVector(el: HTMLElement, spec: AnchoredVectorSpec, scene: AnchorTarget): LiveRow[] {
    const sym = document.createElement('span')
    sym.className = 'cv-sym'
    sym.innerHTML = spec.symbolHtml
    const left = document.createElement('span')
    left.className = 'cv-bracket cv-left'
    const col = document.createElement('span')
    col.className = 'cv-col'
    const right = document.createElement('span')
    right.className = 'cv-bracket cv-right'

    const rows: LiveRow[] = []
    for (const name of spec.channels) {
      const cell = document.createElement('span')
      cell.className = 'cv-val'
      col.appendChild(cell)
      const channel = scene.channels[name]
      if (!channel) console.warn(`anchored vector: unknown channel '${name}'`)
      rows.push({ el: cell, channel, digits: spec.digits })
    }
    el.append(sym, left, col, right)
    return rows
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

    for (const item of this.items) {
      const { spec, el, node } = item
      // live rows refresh every frame — even before reveal — so the vector is
      // already correct the instant it fades in
      if (item.live) {
        for (const row of item.live) {
          row.el.textContent = row.channel ? formatSigned(row.channel.x, row.digits) : '—'
        }
      }
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
      // the §5 fade is a one-way entrance: once shown it stays, so dragging a
      // joint (which un-settles motion) never blinks a live vector back out
      if (revealed) item.revealed = true
      el.classList.toggle('revealed', item.revealed)
    }
  }
}
