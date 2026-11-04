import { compileLecture } from '../compiler/compile-slides'
import type { CameraTargetSpec } from '../engine/slide-types'
import { SCENE_NAMES } from '../scenes/registry'
import type { CameraView } from './camera-edit'
import { compileForEditor, updateCameras } from './editor-compile'
import { createHost } from './host'
import { loadImages } from './panel-images'
import { EDITOR_PROTOCOL } from './panel-page.js'
import { namedTarget, namedViewEdit, viewEdit, viewUsers, type NamedTarget } from './save-view'

/**
 * The editor runtime (lysark-v2.md §5, step 3). It runs as the page of the
 * Lysark panel in VS Code (src/editor/panel-page.js), loaded from the course
 * site, and talks to the extension through VS Code's webview messages. The
 * extension sends the lecture's files (slides.md, and the files matching the
 * page's `include` patterns); this page checks that they compile, reads the
 * lecture's images through the extension, then starts the deck. New text that
 * only changes cameras (a saved view, say) is put into the running deck at
 * once and 'shown'. Other new text that compiles is 'accepted', and the
 * extension then loads the panel afresh and sends that text again on 'ready'.
 * Text that doesn't compile leaves the last good version running and shows
 * the error.
 *
 * Every set of files the extension sends carries a number (seq). The page
 * names the one it shows in 'shown' and 'slide', so the extension knows which
 * text a slide number counts in. Saving a view is computed here and written
 * through the extension's edit request (host.ts, save-view.ts).
 *
 * Messages version 3, all { type: 'lysark:…' } (docs/editor-host.md):
 *   page → extension  ready { protocol, render, include } · shown { seq, index } · accepted { seq }
 *                     slide { index, seq } · error { message, seq?, fatal? }
 *                     read · list · edit · ask, each { id, … } (host.ts)
 *   extension → page  source { files, seq, slide, protocol } · goto { slide }
 *                     request-view · request-actions · reply { id, … }
 */

/** VS Code defines this in its panels; it may be called once per page */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void }

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

/**
 * The files besides slides.md the extension sends with each text, and sends
 * again when one is saved, created or deleted: the lecture's scene files, with
 * its named camera views (docs/scene-files.md).
 */
const INCLUDE = ['scenes/*.yaml', 'scenes/*.yml']

const lysark = () => (window as unknown as { __lysark?: LysarkHandle }).__lysark
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
const post = (message: Record<string, unknown>) => vscode?.postMessage({ ...message })
/**
 * the panel page's render number (src/editor/panel-page.js): the extension
 * tells this page's 'ready' from a late one sent by the page it replaced, and
 * the host's request ids start from it
 */
const render = Number(document.querySelector('meta[name="lysark-render"]')?.getAttribute('content') ?? NaN)
const host = createHost(post, render)
let booted = false
/** the number of the files this page shows, and the files: slides.md and the scene files */
let shownSeq: number | null = null
let shownFiles: Record<string, string> = {}
/** the lecture's images, read when the page started; new text that needs others loads the page afresh */
let images: Record<string, string> = {}
/** a view is being written into the file */
let saving = false
/** the last view saved from this page, as written into the text (two decimals) */
let savedView: { slide: number; lookAt: [number, number, number] | string; offset: [number, number, number] } | null = null

const round2 = (n: number) => Number(n.toFixed(2))

/**
 * Put new text into the running deck without loading the page afresh, if
 * only cameras changed. The slide on screen may only change to the view just
 * saved from it (the camera is already there); any other change to it needs
 * the fresh page, where the camera flies to it.
 */
async function updateInPlace(files: Record<string, string>): Promise<boolean> {
  const engine = lysark()?.engine
  if (!engine) return false
  // the same module instance the deck was built from (it stands in for virtual:lysark-deck)
  const { default: deck } = await import('./deck-from-source')
  const fresh = compileForEditor(files['slides.md'], images, files)
  const i = engine.currentIndex
  const next: CameraTargetSpec | undefined = fresh[i]?.effective.camera
  const isSavedView =
    savedView !== null &&
    savedView.slide === i &&
    next !== undefined &&
    JSON.stringify(next.lookAt) === JSON.stringify(savedView.lookAt) &&
    JSON.stringify(next.offset) === JSON.stringify(savedView.offset)
  if (JSON.stringify(next) !== JSON.stringify(deck.slides[i]?.effective.camera) && !isSavedView) return false
  return updateCameras(deck.slides, fresh) !== null
}

function goTo(slide: number): void {
  const engine = lysark()?.engine
  if (!engine) {
    // still starting: the deck starts on the slide in the address, so a slide
    // asked for now just goes there (before the text arrives, 'source' names it)
    if (booted) location.hash = `#${slide + 1}`
    return
  }
  if (slide !== engine.currentIndex && slide < engine.slideCount) {
    engine.goTo(slide, slide < engine.currentIndex ? 'backward' : 'forward')
  }
}

/** the panel page's "Loading…" text, until the deck has started or failed to */
const clearLoading = () => document.getElementById('lysark-loading')?.remove()

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
document.addEventListener('DOMContentLoaded', () => document.body.append(banner, ...(vscode ? [hint] : [])))

/**
 * The slides that fly to each named view in the files shown, worked out once
 * per view (a compile of the lecture), compared with the running deck.
 */
let usersOf: { seq: number | null; lists: Map<string, number[]> } = { seq: null, lists: new Map() }
async function flyingTo(target: NamedTarget): Promise<number[]> {
  if (usersOf.seq !== shownSeq) usersOf = { seq: shownSeq, lists: new Map() }
  const key = `${target.path}\n${target.view}`
  if (!usersOf.lists.has(key)) {
    const { default: deck } = await import('./deck-from-source')
    usersOf.lists.set(key, viewUsers(shownFiles, target, deck.slides.map((s) => s.effective.camera)))
  }
  return usersOf.lists.get(key)!
}

/**
 * The hint says where V writes on the slide shown: into the slide, or into a
 * named view, and the slides that fly to that view. The list takes a compile,
 * so it follows a moment later, once the camera is on its way.
 */
let hintTimer: number | undefined
function updateHint(): void {
  const engine = lysark()?.engine
  const index = engine?.currentIndex
  const target = engine ? namedTarget(shownFiles, engine.currentIndex) : null
  const text = (users: number[]) =>
    target
      ? `V or the camera button above: change the view '${target.view}' in ${target.path}` +
        (users.length > 1 ? ` (slides ${listSlides(users)} fly to it)` : '')
      : 'V or the camera button above: save this camera view into the slide'
  hint.textContent = text([])
  window.clearTimeout(hintTimer)
  if (!target) return
  const seq = shownSeq
  hintTimer = window.setTimeout(async () => {
    const users = await flyingTo(target)
    if (shownSeq === seq && lysark()?.engine.currentIndex === index) hint.textContent = text(users)
  }, 400)
}

/** slide numbers for people: 2, 5 and 9 */
function listSlides(indices: number[]): string {
  const numbers = indices.map((i) => String(i + 1))
  return numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}` : (numbers[0] ?? '')
}

let bannerTimer: number | undefined
/** the banner says a view was just saved (showSaved) */
let savedShowing = false
function showBanner(text: string | null, kind: 'error' | 'ok' = 'error'): void {
  window.clearTimeout(bannerTimer)
  savedShowing = false
  if (!text) {
    banner.style.display = 'none'
    return
  }
  banner.textContent = text
  banner.style.display = 'block'
  banner.style.background = kind === 'error' ? 'rgba(var(--accent-rgb), 0.92)' : 'rgba(var(--good-rgb), 0.92)'
  banner.style.color = kind === 'error' ? 'var(--text)' : 'var(--bg)'
  if (kind === 'ok') bannerTimer = window.setTimeout(() => showBanner(null), 2500)
}

/** null if the files compile and name only known scenes; otherwise the problem */
function problemWith(files: Record<string, string>): string | null {
  try {
    const { slides } = compileLecture(files['slides.md'], files)
    const known = new Set<string>(SCENE_NAMES)
    const bad = slides.find((s) => s.scene && !known.has(s.scene))
    if (bad) return `slide '${bad.id}' uses unknown scene '${bad.scene}'. Available: ${SCENE_NAMES.join(', ')}`
    return null
  } catch (err) {
    return String((err as Error)?.message ?? err)
  }
}

// ---- messages from the extension -------------------------------------------

window.addEventListener('message', async (event) => {
  // VS Code delivers the extension's messages from its own frames, which share
  // this page's origin. A frame inside the slides has another origin (or none),
  // so it can't pose as the extension. (window.parent is no help: VS Code's
  // panel script sets it to the page itself.)
  if (!vscode || event.origin !== window.origin) return
  const message = event.data as { type?: string; files?: unknown; slide?: number; seq?: number; protocol?: number }
  if (host.onReply(message)) return
  if (message?.type === 'lysark:source' && typeof message.seq === 'number') {
    // the same text again (a message that crossed a reload): already showing it
    if (booted && message.seq === shownSeq) return
    // slides.md and the scene files, as text
    const files = Object.fromEntries(
      Object.entries((message.files ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    )
    const text = files['slides.md']
    if (message.protocol !== EDITOR_PROTOCOL || typeof text !== 'string') {
      const problem = `This Lysark extension doesn't match the course's engine (messages version ${message.protocol ?? 'unknown'}, the engine has ${EDITOR_PROTOCOL}). Update the extension, or the course's engine.`
      showBanner(problem)
      post({ type: 'lysark:error', message: problem, seq: message.seq })
      return
    }
    const problem = problemWith(files)
    if (problem) {
      savedView = null // a view saved from this page is known again only in the text that comes right back
      if (!booted) clearLoading() // nothing to show yet but the error
      showBanner(`Not updated, the slides have an error:\n${problem}`)
      post({ type: 'lysark:error', message: problem, seq: message.seq })
      return
    }
    if (booted) {
      if (await updateInPlace(files)) {
        // only cameras changed: the running deck has them now
        shownSeq = message.seq
        shownFiles = files
        savedView = null
        // (a view just saved keeps its message: this is its text coming back)
        if (!savedShowing) showBanner(null)
        updateHint()
        post({ type: 'lysark:shown', seq: shownSeq, index: lysark()?.engine.currentIndex })
        return
      }
      // other new text: the extension loads this page afresh and sends it again on 'ready'
      savedView = null
      post({ type: 'lysark:accepted', seq: message.seq })
      return
    }
    showBanner(null)
    shownSeq = message.seq
    shownFiles = files
    if (typeof message.slide === 'number' && message.slide >= 0) location.hash = `#${message.slide + 1}`
    booted = true
    // the images first: the deck is built with them (a slide asked for meanwhile
    // goes into the address, where the deck starts)
    // (a request at a time can be large and slow in github.dev: two minutes each)
    const loaded = await loadImages(compileLecture(text, files).images, (paths) => host.read(paths, 'bytes', 120_000))
    images = loaded.uris
    window.__LYSARK_FILES__ = files
    window.__LYSARK_IMAGES__ = images
    try {
      await import('../main')
      clearLoading()
      updateHint()
      post({ type: 'lysark:shown', seq: shownSeq, index: lysark()?.engine.currentIndex })
      if (loaded.problems.length > 0) {
        showBanner(`Images not shown:\n${loaded.problems.join('\n')}`)
      }
    } catch (err) {
      // the deck's files didn't load (a network failure, or the site was
      // republished meanwhile): only loading the panel afresh helps
      const text = String((err as Error)?.message ?? err)
      clearLoading()
      showBanner(`The preview failed to start:\n${text}`)
      post({ type: 'lysark:error', message: text, fatal: true })
    }
  } else if (message?.type === 'lysark:request-view') {
    void saveView()
  } else if (message?.type === 'lysark:request-actions') {
    void sceneActions()
  } else if (message?.type === 'lysark:goto' && typeof message.slide === 'number') {
    goTo(message.slide)
  }
})

/** the "Scene Actions…" button: what the panel can do, as a list in VS Code */
async function sceneActions(): Promise<void> {
  const engine = lysark()?.engine
  const target = engine ? namedTarget(shownFiles, engine.currentIndex) : null
  const users = target ? await flyingTo(target) : []
  const choice = await host.ask({
    title: 'Lysark: scene actions',
    items: [
      {
        label: target ? `Change the view '${target.view}' to this camera view` : 'Save camera view into this slide',
        description: target ? `V, in ${target.path}` + (users.length > 1 ? `; slides ${listSlides(users)} use it` : '') : 'V',
        value: 'save-view',
      },
    ],
  })
  if (choice === 'save-view') await saveView()
}

// ---- save the camera view --------------------------------------------------

async function saveView(): Promise<void> {
  const L = lysark()
  if (!L || saving) return
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
  const view: CameraView = { lookAt, offset: [offset.x, offset.y, offset.z] }
  const index = L.engine.currentIndex
  // as the edit writes it (camera-edit.ts, two decimals), to know it again when the text comes back
  const rounded = {
    slide: index,
    lookAt: typeof lookAt === 'string' ? lookAt : ([round2(lookAt[0]), round2(lookAt[1]), round2(lookAt[2])] as [number, number, number]),
    offset: [round2(offset.x), round2(offset.y), round2(offset.z)] as [number, number, number],
  }
  // a slide that names a view (`camera: overview`) saves into that view; any other into the slide
  const target = namedTarget(shownFiles, index)
  saving = true
  try {
    if (target) await saveNamedView(target, view, rounded)
    else await saveSlideView(index, view, rounded)
  } finally {
    saving = false
  }
}

/** the view into the slide's own frontmatter in slides.md */
async function saveSlideView(index: number, view: CameraView, rounded: NonNullable<typeof savedView>): Promise<void> {
  const shown = shownFiles['slides.md']
  // the file as it is now in VS Code, unsaved typing included
  const file = (await host.read(['slides.md'], 'text'))['slides.md']
  if (typeof file.text !== 'string' || typeof file.version !== 'number') {
    showBanner(`The view was not saved: slides.md could not be read (${file.error ?? 'no text'}).`)
    return
  }
  const change = viewEdit(shown, file.text, index, view)
  if (change && 'problem' in change) {
    showBanner(`The view was not saved: ${change.problem}`)
    return
  }
  if (!change) {
    showBanner(`Slide ${index + 1} already has this camera view`, 'ok')
    return
  }
  const next = file.text.slice(0, change.start) + change.text + file.text.slice(change.end)
  const broken = problemWith({ ...shownFiles, 'slides.md': next })
  if (broken && !problemWith({ ...shownFiles, 'slides.md': file.text })) {
    showBanner(`The view was not saved: the slides would have an error:\n${broken}`)
    return
  }
  savedView = rounded
  const result = await host.edit('Save camera view', [{ path: 'slides.md', version: file.version, ...change }])
  if (!result.ok) {
    savedView = null
    showBanner(`The view was not saved: ${result.message ?? 'VS Code refused the edit'}`)
    return
  }
  // the extension sends the edited text, which puts the view into the running deck
  showSaved(`Camera view saved to slide ${index + 1}`)
}

/** the view into the named view the slide uses, in the lecture's scene file (docs/scene-files.md) */
async function saveNamedView(target: NamedTarget, view: CameraView, rounded: NonNullable<typeof savedView>): Promise<void> {
  // the scene file as it is now in VS Code, unsaved typing included
  const file = (await host.read([target.path], 'text'))[target.path]
  if (typeof file.text !== 'string' || typeof file.version !== 'number') {
    showBanner(`The view was not saved: ${target.path} could not be read (${file.error ?? 'no text'}).`)
    return
  }
  const change = namedViewEdit(file.text, target.view, view)
  if (change && 'problem' in change) {
    showBanner(`The view was not saved: ${change.problem}`)
    return
  }
  if (!change) {
    showBanner(`The view '${target.view}' already is this camera view`, 'ok')
    return
  }
  const next = file.text.slice(0, change.start) + change.text + file.text.slice(change.end)
  const before = { ...shownFiles, [target.path]: file.text }
  const after = { ...shownFiles, [target.path]: next }
  const broken = problemWith(after)
  if (broken && !problemWith(before)) {
    showBanner(`The view was not saved: the slides would have an error:\n${broken}`)
    return
  }
  // every slide whose camera changes with it: the slides that name it, and those that carry it on
  let changed: number[] = []
  try {
    const was = compileLecture(before['slides.md'], before).slides
    const now = compileLecture(after['slides.md'], after).slides
    changed = now.flatMap((s, i) => (JSON.stringify(s.effective.camera) !== JSON.stringify(was[i]?.effective.camera) ? [i] : []))
  } catch {
    // the shown slides with the scene file as it is now don't compile: name none
  }
  savedView = rounded
  const result = await host.edit(`Save camera view '${target.view}'`, [{ path: target.path, version: file.version, ...change }])
  if (!result.ok) {
    savedView = null
    showBanner(`The view was not saved: ${result.message ?? 'VS Code refused the edit'}`)
    return
  }
  // the extension sends the edited scene file, which puts the view into the running deck.
  // The scene file is changed in VS Code, usually with no editor open on it: say it isn't saved
  showSaved(
    `View '${target.view}' changed in ${target.path}, not saved yet (File > Save All)` +
      (changed.length > 0 ? `: slide${changed.length > 1 ? 's' : ''} ${listSlides(changed)} now fl${changed.length > 1 ? 'y' : 'ies'} to it` : ''),
  )
}

/**
 * Say the view was saved. The edited text comes back from the extension a
 * moment later and is put into the deck; that update keeps this message.
 */
function showSaved(text: string): void {
  showBanner(text, 'ok')
  savedShowing = true
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'v' || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
  void saveView()
})

window.addEventListener('hashchange', () => {
  // after the deck has moved: its own listener (src/main.ts) runs after this one
  window.setTimeout(() => {
    const engine = lysark()?.engine
    if (engine) post({ type: 'lysark:slide', index: engine.currentIndex, seq: shownSeq })
    updateHint()
  }, 0)
})

window.addEventListener('error', (e) => post({ type: 'lysark:error', message: String(e.message) }))

// a link to another slide (`[back to the setup](#3)`): VS Code's panel swallows
// the click (it looks for an element with that id), so follow it here first
document.addEventListener('click', (e) => {
  const link = vscode && e.target instanceof Element ? e.target.closest('a[href^="#"]') : null
  if (!link) return
  e.preventDefault()
  e.stopPropagation()
  location.hash = link.getAttribute('href') ?? ''
})

// VS Code gives every panel default styles (body padding, code and image
// styling) where the deck sets nothing; without them the panel looks like
// the student file
document.getElementById('_defaultStyles')?.remove()

if (vscode) {
  post({ type: 'lysark:ready', protocol: EDITOR_PROTOCOL, render, include: INCLUDE })
} else {
  // Framed, this page is in the panel of Lysark extension 0.1.0, which framed
  // the site's editor page (VS Code's own panel page has window.parent ===
  // window). Opened directly, it's someone looking at the course site.
  const note =
    window.parent !== window
      ? "This Lysark extension is older than the course's engine: update the Lysark extension (0.3.0 or later)."
      : 'This is the Lysark editor runtime. It runs inside the Lysark panel in VS Code: open a slides.md and click "Open Lysark Preview".'
  document.addEventListener('DOMContentLoaded', () => showBanner(note))
}
