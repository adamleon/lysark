import type { CompiledSlide, WidgetSpec } from '../engine/slide-types'

export interface OverlayContext {
  /** returns a live DOM element for a widget spec, or null if it can't bind */
  createWidget(spec: WidgetSpec): HTMLElement | null
}

const FADE_MS = 160

/**
 * Screen-mode overlay renderer (spec §4.2): swaps slide content with fades,
 * reveals fragments in place. Anchored mode arrives in M5.
 */
export class Overlay {
  private readonly host: HTMLElement
  private content: HTMLElement | null = null
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
      this.content?.remove()
      this.content = this.build(slide, this.desiredChunks, ctx)
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

  private build(slide: CompiledSlide, visibleChunks: number, ctx: OverlayContext): HTMLElement {
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

    if (slide.widgets.length > 0) {
      const widgetBox = document.createElement('div')
      widgetBox.className = 'slide-widgets'
      for (const spec of slide.widgets) {
        const el = ctx.createWidget(spec)
        if (el) widgetBox.appendChild(el)
      }
      content.appendChild(widgetBox)
    }
    return content
  }
}
