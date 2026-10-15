import { compileLecture } from '../compiler/compile-slides'
import { SCENE_NAMES } from '../scenes/registry'
import { isPanelOrigin } from './panel-origin'

/**
 * The editor runtime (lysark-v2.md §5, step 3): this page runs inside the
 * Lysark panel in VS Code. The panel sends the lecture text; this page checks
 * that it compiles, then starts the deck with it. New text that compiles
 * reloads the page ('accepted'), and the panel answers the reload's 'ready'
 * with that text. Text that doesn't compile leaves the last good version
 * running and shows the error.
 *
 * Every text the panel sends carries a number (seq). The page names the one it
 * shows in 'shown', 'slide' and 'save-view', so the panel knows which text a
 * slide number counts in (docs/step-3-editor-test.md).
 *
 * Messages, all { type: 'lysark:…' }:
 *   page → panel  ready · shown { seq } · accepted { seq } · slide { index, seq }
 *                 save-view { slide, seq, view } · error { message, seq? }
 *   panel → page  source { text, seq, slide } · goto { slide } · request-view
 */

interface Vec3Like {
  x: number
  y: number
  z: number
  clone(): Vec3Like
  sub(v: Vec3Like): Vec3Like
  distanceTo(v: Vec3Like): number
}
interface LysarkHandle {
  sceneLayer: { camera: { position: Vec3Like } }
  controls: { target: Vec3Like }
  cameraCtl: { active: boolean; lookTarget: Vec3Like }
  engine: {
    currentIndex: number
    slideCount: number
    current: { scene?: string; effective: { camera?: { lookAt?: unknown } } }
    goTo(index: number, direction?: 'forward' | 'backward'): void
  }
  sceneManager: {
    busy: boolean
    activeSceneId: string | undefined
    active: { anchors: Record<string, { getWorldPosition(v: Vec3Like): Vec3Like }> } | null
  }
}

/** a saved view keeps the slide's anchor only if the camera still looks at it (metres) */
const ANCHOR_TOLERANCE = 0.005

const lysark = () => (window as unknown as { __lysark?: LysarkHandle }).__lysark
const post = (message: Record<string, unknown>) => window.parent.postMessage({ ...message }, '*')
const embedded = window.parent !== window
let booted = false
/** the number of the text this page shows */
let shownSeq: number | null = null

// ---- small status banner (errors, saved views) -----------------------------

const banner = document.createElement('div')
banner.style.cssText =
  'position:fixed;left:12px;right:12px;bottom:12px;z-index:1000;padding:10px 14px;border-radius:8px;' +
  'font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap;display:none;pointer-events:none'
const hint = document.createElement('div')
hint.textContent = 'V or the camera button above: save this camera view into the slide'
hint.style.cssText =
  'position:fixed;left:12px;top:10px;z-index:1000;padding:3px 8px;border-radius:6px;font:12px system-ui,sans-serif;' +
  'color:var(--text-dim);background:rgba(var(--surface-rgb),0.8);pointer-events:none'
document.addEventListener('DOMContentLoaded', () => document.body.append(banner, hint))

let bannerTimer: number | undefined
function showBanner(text: string | null, kind: 'error' | 'ok' = 'error'): void {
  window.clearTimeout(bannerTimer)
  if (!text) {
    banner.style.display = 'none'
    return
  }
  banner.textContent = text
  banner.style.display = 'block'
  banner.style.background = kind === 'error' ? 'rgba(196,30,30,0.92)' : 'rgba(27,138,74,0.92)'
  banner.style.color = '#fff'
  if (kind === 'ok') bannerTimer = window.setTimeout(() => showBanner(null), 2500)
}

/** null if the text compiles and names only known scenes; otherwise the problem */
function problemWith(text: string): string | null {
  try {
    const { slides } = compileLecture(text)
    const known = new Set<string>(SCENE_NAMES)
    const bad = slides.find((s) => s.scene && !known.has(s.scene))
    if (bad) return `slide '${bad.id}' uses unknown scene '${bad.scene}'. Available: ${SCENE_NAMES.join(', ')}`
    return null
  } catch (err) {
    return String((err as Error)?.message ?? err)
  }
}

// ---- messages from the panel -----------------------------------------------

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent) return
  const message = event.data as { type?: string; text?: string; slide?: number; seq?: number }
  if (!isPanelOrigin(event.origin, location.hostname)) {
    if (typeof message?.type === 'string' && message.type.startsWith('lysark:')) {
      showBanner(`Ignored the lecture from ${event.origin}: only the Lysark panel in VS Code can use this page.`)
    }
    return
  }
  if (message?.type === 'lysark:source' && typeof message.text === 'string' && typeof message.seq === 'number') {
    const problem = problemWith(message.text)
    if (problem) {
      showBanner(`Not updated, the slides have an error:\n${problem}`)
      post({ type: 'lysark:error', message: problem, seq: message.seq })
      return
    }
    if (booted) {
      // new text: reload, and the panel sends this text again on 'ready'
      post({ type: 'lysark:accepted', seq: message.seq })
      location.reload()
      return
    }
    showBanner(null)
    window.__LYSARK_SOURCE__ = message.text
    shownSeq = message.seq
    if (typeof message.slide === 'number' && message.slide >= 0) location.hash = `#${message.slide + 1}`
    booted = true
    try {
      await import('../main')
      post({ type: 'lysark:shown', seq: shownSeq })
    } catch (err) {
      const text = String((err as Error)?.message ?? err)
      showBanner(text)
      post({ type: 'lysark:error', message: text })
    }
  } else if (message?.type === 'lysark:request-view') {
    saveView()
  } else if (message?.type === 'lysark:goto' && typeof message.slide === 'number') {
    const engine = lysark()?.engine
    if (engine && message.slide !== engine.currentIndex && message.slide < engine.slideCount) {
      engine.goTo(message.slide, message.slide < engine.currentIndex ? 'backward' : 'forward')
    }
  }
})

// ---- save the camera view --------------------------------------------------

function saveView(): void {
  const L = lysark()
  if (!L) return
  const slide = L.engine.current
  if (!slide.scene) {
    showBanner('This slide has no 3D scene, so there is no camera view to save.')
    return
  }
  if (L.sceneManager.busy || L.sceneManager.activeSceneId !== slide.scene) {
    // the slide has changed but its scene is still being swapped in
    showBanner('The scene is still loading; press V again in a moment.')
    return
  }
  const camera = L.sceneLayer.camera.position
  // mid-flight, the orbit target still holds the previous slide's point; the
  // camera looks at the flight's live point (src/main.ts, flyTo)
  let center = L.cameraCtl.active ? L.cameraCtl.lookTarget : L.controls.target
  let lookAt: [number, number, number] | string = [center.x, center.y, center.z]
  const declared = slide.effective.camera?.lookAt
  const anchor = typeof declared === 'string' ? L.sceneManager.active?.anchors[declared] : undefined
  const anchorAt = anchor?.getWorldPosition(camera.clone())
  if (typeof declared === 'string' && anchorAt && anchorAt.distanceTo(center) < ANCHOR_TOLERANCE) {
    // the slide follows an anchor and the camera still looks at it: keep it.
    // Otherwise (panned away, or the anchor has moved since) save the point.
    lookAt = declared
    center = anchorAt
  }
  const offset = camera.clone().sub(center)
  post({
    type: 'lysark:save-view',
    slide: L.engine.currentIndex,
    seq: shownSeq,
    view: { lookAt, offset: [offset.x, offset.y, offset.z] },
  })
  showBanner(`Camera view saved to slide ${L.engine.currentIndex + 1}`, 'ok')
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'v' || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
  saveView()
})

window.addEventListener('hashchange', () => {
  const engine = lysark()?.engine
  if (engine) post({ type: 'lysark:slide', index: engine.currentIndex, seq: shownSeq })
})

window.addEventListener('error', (e) => post({ type: 'lysark:error', message: String(e.message) }))

if (embedded) {
  post({ type: 'lysark:ready' })
} else {
  document.addEventListener('DOMContentLoaded', () =>
    showBanner('This is the Lysark editor runtime. Open a slides.md in VS Code and click "Open Lysark Preview".'),
  )
}
