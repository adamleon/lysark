import type { CompiledSlide } from '../engine/slide-types'

export interface PresenterDeps {
  slides: CompiledSlide[]
  /** jump to a slide (the engine resolves direction) */
  goTo(index: number): void
  currentIndex(): number
}

const SHORTCUTS: [string, string][] = [
  ['→ / Space / PageDn', 'Next fragment or slide'],
  ['← / PageUp', 'Previous fragment or slide'],
  ['Home / End', 'First / last slide'],
  ['o', 'Slide overview'],
  ['f', 'Toggle fullscreen'],
  ['d', 'Debug / tuning panel'],
  ['t', 'Log current tuning as YAML'],
  ['?', 'This help'],
  ['Esc', 'Close overlay'],
]

/**
 * Presenter niceties (spec §11): a position indicator + progress bar, an
 * overview grid of every slide (keyboard-navigable, click to jump), and a
 * shortcut help card. All plain DOM in the overlay layer — no WebGL, no rAF.
 */
export class Presenter {
  private readonly counter: HTMLElement
  private readonly progress: HTMLElement
  private readonly overview: HTMLElement
  private readonly overviewGrid: HTMLElement
  private readonly help: HTMLElement
  private readonly cards: HTMLElement[] = []
  private selected = 0

  constructor(
    host: HTMLElement,
    private readonly deps: PresenterDeps,
  ) {
    // position indicator + top progress bar
    this.progress = el('div', 'deck-progress')
    this.counter = el('div', 'deck-counter')
    host.append(this.progress, this.counter)

    // overview
    this.overview = el('div', 'overview hidden')
    this.overviewGrid = el('div', 'overview-grid')
    this.overview.appendChild(this.overviewGrid)
    this.overview.addEventListener('click', (e) => {
      if (e.target === this.overview) this.closeModals() // click backdrop
    })
    deps.slides.forEach((slide, i) => {
      const card = el('button', 'overview-card')
      const num = el('span', 'overview-num')
      num.textContent = String(i + 1)
      const title = el('span', 'overview-title')
      title.textContent = slide.title
      const badge = el('span', 'overview-badge')
      badge.textContent = slide.scene ?? 'text'
      if (!slide.scene) badge.classList.add('sceneless')
      card.append(num, title, badge)
      card.addEventListener('click', () => {
        this.closeModals()
        deps.goTo(i)
      })
      this.overviewGrid.appendChild(card)
      this.cards.push(card)
    })
    host.appendChild(this.overview)

    // help
    this.help = el('div', 'help-card hidden')
    const h = el('h2', '')
    h.textContent = 'Keyboard'
    this.help.appendChild(h)
    for (const [key, desc] of SHORTCUTS) {
      const row = el('div', 'help-row')
      const k = el('kbd', '')
      k.textContent = key
      const d = el('span', '')
      d.textContent = desc
      row.append(k, d)
      this.help.appendChild(row)
    }
    host.appendChild(this.help)
  }

  get modalOpen(): boolean {
    return !this.overview.classList.contains('hidden') || !this.help.classList.contains('hidden')
  }

  /** update indicator + overview highlight; call on every slide change */
  setSlide(index: number): void {
    const total = this.deps.slides.length
    this.counter.textContent = `${index + 1} / ${total}`
    this.progress.style.width = `${((index + 1) / total) * 100}%`
    this.cards.forEach((c, i) => c.classList.toggle('current', i === index))
  }

  /**
   * Handle a key. Returns true if the presenter consumed it (so the caller
   * skips slide navigation). Owns overview/help modals, Home/End, o/?/f/Esc.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (this.modalOpen) {
      if (e.key === 'Escape' || e.key === 'o' || e.key === '?') {
        this.closeModals()
        return true
      }
      // both modals fully capture input — no key leaks to deck navigation, so
      // the overview never desyncs from the deck behind it. The overview applies
      // its own nav effect; help just swallows.
      if (!this.overview.classList.contains('hidden')) this.overviewKey(e)
      return true
    }
    switch (e.key) {
      case 'o':
        this.openOverview()
        return true
      case '?':
        this.help.classList.remove('hidden')
        return true
      case 'f':
        this.toggleFullscreen()
        return true
      case 'Home':
        this.deps.goTo(0)
        return true
      case 'End':
        this.deps.goTo(this.deps.slides.length - 1)
        return true
      default:
        return false
    }
  }

  private overviewKey(e: KeyboardEvent): void {
    const last = this.cards.length - 1
    // PageDown/PageUp move the selection here (they never reach deck nav while
    // a modal is open), matching their next/prev role in the shortcut list
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
      this.select(this.selected + 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
      this.select(this.selected - 1)
    } else if (e.key === 'Home') {
      this.select(0)
    } else if (e.key === 'End') {
      this.select(last)
    } else if (e.key === 'Enter' || e.key === ' ') {
      const target = this.selected
      this.closeModals()
      this.deps.goTo(target)
    }
  }

  private openOverview(): void {
    this.help.classList.add('hidden')
    this.select(this.deps.currentIndex())
    this.overview.classList.remove('hidden')
  }

  private closeModals(): void {
    this.overview.classList.add('hidden')
    this.help.classList.add('hidden')
  }

  private select(i: number): void {
    this.selected = Math.max(0, Math.min(this.cards.length - 1, i))
    this.cards.forEach((c, idx) => c.classList.toggle('selected', idx === this.selected))
    this.cards[this.selected]?.scrollIntoView({ block: 'nearest' })
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}
