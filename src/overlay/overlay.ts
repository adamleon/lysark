import type { CompiledSlide, WidgetSpec } from '../engine/slide-types'

/** a live overlay widget: its DOM element plus optional per-frame + teardown */
export interface WidgetHandle {
  el: HTMLElement
  /** advance the widget one frame (t in seconds) — plots sample here */
  onFrame?(t: number): void
  /** free resources on slide swap (uPlot instances, listeners) */
  dispose?(): void
}

export interface OverlayContext {
  /** returns a live widget handle for a spec, or null if it can't bind */
  createWidget(spec: WidgetSpec): WidgetHandle | null
}

const FADE_MS = 160

/**
 * Screen-mode overlay renderer (spec §4.2): swaps slide content with fades,
 * reveals fragments in place, and drives live widgets (plots) per frame.
 * Anchored-mode elements live in a separate AnchorLayer (projected per frame).
 */
export class Overlay {
  private readonly host: HTMLElement
  private content: HTMLElement | null = null
  private live: WidgetHandle[] = []
  private pendingSwap: number | null = null
  /** latest requested fragment count — read at swap time, not captured, so
      reveals issued during the fade window aren't lost (rapid keypresses) */
  private desiredChunks = 1

  constructor(host: HTMLElement) {
    this.host = host
  }

  /** full slide swap with a fade; visibleChunks counts fragments shown (≥1) */
  show(slide: CompiledSlide, visibleChunks: number, ctx: OverlayContext): void {
    this.desiredChunks = visibleChunks
    if (this.pendingSwap !== null) window.clearTimeout(this.pendingSwap)
    const swap = () => {
      this.pendingSwap = null
      this.disposeLive()
      this.content?.remove()
      const built = this.build(slide, this.desiredChunks, ctx)
      this.content = built.el
      this.live = built.live
      this.host.appendChild(this.content)
      // double rAF so the fade-in transition actually runs after insert
      requestAnimationFrame(() =>
        requestAnimationFrame(() => this.content?.classList.add('shown')),
      )
    }
    if (this.content) {
      this.content.classList.remove('shown')
      this.pendingSwap = window.setTimeout(swap, FADE_MS)
    } else {
      swap()
    }
  }

  /** advance live widgets (plots) — called once per frame by the run loop */
  tick(t: number): void {
    for (const w of this.live) w.onFrame?.(t)
  }

  /** fragment step within the current slide — no swap, just reveal/hide */
  setVisibleChunks(visibleChunks: number): void {
    this.desiredChunks = visibleChunks
    // mid-fade: the pending swap reads desiredChunks when it builds
    if (!this.content || this.pendingSwap !== null) return
    this.content.querySelectorAll<HTMLElement>('.fragment').forEach((el, i) => {
      // fragment elements are chunks 1..N-1; chunk 0 is not wrapped
      el.classList.toggle('visible', i + 1 < visibleChunks)
    })
  }

  private disposeLive(): void {
    for (const w of this.live) w.dispose?.()
    this.live = []
  }

  private build(
    slide: CompiledSlide,
    visibleChunks: number,
    ctx: OverlayContext,
  ): { el: HTMLElement; live: WidgetHandle[] } {
    const content = document.createElement('div')
    content.className = `slide-content layout-${slide.layout}`

    slide.fragments.forEach((html, i) => {
      const chunk = document.createElement('div')
      chunk.innerHTML = html
      if (i > 0) {
        chunk.className = 'fragment'
        if (i + 1 <= visibleChunks) chunk.classList.add('visible')
      }
      content.appendChild(chunk)
    })

    const live: WidgetHandle[] = []
    if (slide.widgets.length > 0) {
      const widgetBox = document.createElement('div')
      widgetBox.className = 'slide-widgets'
      for (const spec of slide.widgets) {
        const handle = ctx.createWidget(spec)
        if (!handle) continue
        widgetBox.appendChild(handle.el)
        if (handle.onFrame || handle.dispose) live.push(handle)
      }
      content.appendChild(widgetBox)
    }
    return { el: content, live }
  }
}
