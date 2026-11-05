import { compileLecture } from '../compiler/compile-slides'
import type { CameraTargetSpec } from '../engine/slide-types'
import { SCENE_NAMES } from '../scenes/registry'
import { viewNameProblem, type CameraView } from './camera-edit'
import { compileForEditor, updateCameras } from './editor-compile'
import { createHost, type HostChange } from './host'
import { loadImages } from './panel-images'
import { EDITOR_PROTOCOL } from './panel-page.js'
import {
  namedTarget,
  namedViewEdit,
  saveAsChanges,
  saveAsChoices,
  viewEdit,
  viewUsers,
  type NamedTarget,
  type SaveAs,
  type SaveAsChoices,
} from './save-view'

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
    current: { scene?: string; effective: { camera?: { lookAt?: unknown; spring?: { omega?: number; zeta?: number } } } }
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
/** an error waiting to be reported, in case newer files follow at once */
let pendingError: number | undefined
const ERROR_DELAY_MS = 750
/**
 * the last view saved from this page, as written into the text (two
 * decimals), and the file text its edit makes: the update with that text is
 * the one that brings the view, and uses it up
 */
let savedView: {
  slide: number
  lookAt: [number, number, number] | string
  offset: [number, number, number]
  expect?: { path: string; text: string }
} | null = null

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
  const changesSlideShown = JSON.stringify(next) !== JSON.stringify(deck.slides[i]?.effective.camera)
  if (changesSlideShown && !isSavedView) return false
  if (updateCameras(deck.slides, fresh) === null) return false
  // the saved view is used up once its edit's text has come (or it was put on
  // the slide shown). Until then it waits: files in between (VS Code reports a
  // file the edit creates before the edit's own text comes) mustn't use it up
  const expect = savedView?.expect
  if ((expect && files[expect.path] === expect.text) || (changesSlideShown && isSavedView)) savedView = null
  return true
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
hint.textContent = 'Ctrl+S in the text updates the preview · V or the camera button above: save this camera view into the slide · Shift+V: save as…'
hint.style.cssText =
  'position:fixed;left:12px;top:10px;z-index:1000;padding:3px 8px;border-radius:6px;font:12px system-ui,sans-serif;' +
  'color:var(--text-dim);background:rgba(var(--surface-rgb),0.8);pointer-events:none'
document.addEventListener('DOMContentLoaded', () => document.body.append(banner, ...(vscode ? [hint] : [])))

/**
 * The slides that fly to each named view in the files shown, worked out once
 * per view (a compile of the lecture), compared with the running deck.
 */
let usersOf: { seq: number | null; lists: Map<string, number[]> } = { seq: null, lists: new Map() }
function usersWith(cameras: unknown[]): (target: NamedTarget) => number[] {
  return (target) => {
    if (usersOf.seq !== shownSeq) usersOf = { seq: shownSeq, lists: new Map() }
    const key = `${target.path}\n${target.view}`
    if (!usersOf.lists.has(key)) usersOf.lists.set(key, viewUsers(shownFiles, target, cameras))
    return usersOf.lists.get(key)!
  }
}
async function flyingTo(target: NamedTarget): Promise<number[]> {
  return usersWith(await shownCameras())(target)
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
  // saving is what updates the panel (github.dev's auto-save doesn't), so the hint says so
  const text = (users: number[]) =>
    'Ctrl+S in the text updates the preview · ' +
    (target
      ? `V or the camera button above: change the view '${target.view}' in ${target.path}` +
        (users.length > 1 ? ` (slides ${listSlides(users)} fly to it)` : '')
      : 'V or the camera button above: save this camera view into the slide') +
    ' · Shift+V: save as…'
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
    window.clearTimeout(pendingError)
    if (problem) {
      const seq = message.seq
      const report = () => {
        savedView = null // a view saved from this page is known again only in the text that comes right back
        if (!booted) clearLoading() // nothing to show yet but the error
        showBanner(`Not updated, the slides have an error:\n${problem}`)
        post({ type: 'lysark:error', message: problem, seq })
      }
      // Undoing a Save view as… that made a scene file passes through files
      // that don't compile (VS Code deletes the file a moment before it puts
      // slides.md back): a running deck waits a little for the next files
      // before it reports an error
      if (booted) pendingError = window.setTimeout(report, ERROR_DELAY_MS)
      else report()
      return
    }
    if (booted) {
      if (await updateInPlace(files)) {
        // only cameras changed: the running deck has them now
        shownSeq = message.seq
        shownFiles = files
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

/**
 * The "Scene Actions…" button: what the panel can do, as a list in VS Code:
 * save the view as V does, or as Save view as… does (only this slide, an
 * existing view, a new view, whose name VS Code then asks for).
 */
async function sceneActions(): Promise<void> {
  const engine = lysark()?.engine
  const target = engine ? namedTarget(shownFiles, engine.currentIndex) : null
  const users = target ? await flyingTo(target) : []
  const choices = await choicesHere()
  const items = [
    {
      label: target ? `Change the view '${target.view}' to this camera view` : 'Save camera view into this slide',
      description: target ? `V, in ${target.path}` + (users.length > 1 ? `; slides ${listSlides(users)} use it` : '') : 'V',
      value: 'save-view',
    },
  ]
  if (choices) {
    if (choices.current) {
      items.push({ label: 'Save as: only this slide', description: `its own camera, instead of the view '${choices.current}'`, value: 'slide' })
    }
    for (const v of choices.views) {
      if (v.name === choices.current) continue
      items.push({
        label: `Save as: the view '${v.name}'`,
        description: 'this slide uses it from now on' + (v.users.length > 0 ? `; now on slides ${listSlides(v.users)}` : ''),
        value: `view:${v.name}`,
      })
    }
    items.push({ label: 'Save as: a new view…', description: choices.exists ? `in ${choices.path}` : `creates ${choices.path}`, value: 'new' })
  }
  const choice = await host.ask({ title: 'Lysark: scene actions', items })
  if (choice === 'save-view') return saveView()
  if (!choice || !choices) return
  if (choice === 'slide') await saveAs({ kind: 'slide' }, choices)
  else if (choice.startsWith('view:')) await saveAs({ kind: 'view', name: choice.slice(5) }, choices)
  else if (choice === 'new') {
    // VS Code asks for the name; a name that won't do is asked for again, saying why
    let prompt = "The new view's name: one word, such as 'oversikt'"
    for (;;) {
      const answer = await host.ask({ title: 'Lysark: new view', input: { prompt, placeholder: 'oversikt' } })
      if (answer === null) return
      const name = answer.trim()
      const problem = viewNameProblem(name, choices.views.map((v) => v.name))
      if (!problem) return void (await saveAs({ kind: 'new', name }, choices))
      prompt = `${problem[0].toUpperCase()}${problem.slice(1)}. Try another name.`
    }
  }
}

// ---- save the camera view --------------------------------------------------

/**
 * The camera as it is now, as a view to save: its value, as the edit writes it
 * (two decimals, to know it again when the text comes back), and the slide.
 * null, saying why, if there is none to save.
 */
function currentView(): { view: CameraView; rounded: NonNullable<typeof savedView>; index: number } | null {
  const L = lysark()
  if (!L) return null
  const slide = L.engine.current
  if (!slide.scene) {
    showBanner('This slide has no 3D scene, so there is no camera view to save.')
    return null
  }
  if (L.sceneManager.busy || L.sceneManager.activeSceneId !== slide.scene) {
    // the slide has changed but its scene is still being swapped in
    showBanner('The scene is still loading; try again in a moment.')
    return null
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
  const index = L.engine.currentIndex
  return {
    view: { lookAt, offset: [offset.x, offset.y, offset.z], ...(slide.effective.camera?.spring ? { spring: slide.effective.camera.spring } : {}) },
    rounded: {
      slide: index,
      lookAt: typeof lookAt === 'string' ? lookAt : [round2(lookAt[0]), round2(lookAt[1]), round2(lookAt[2])],
      offset: [round2(offset.x), round2(offset.y), round2(offset.z)],
    },
    index,
  }
}

async function saveView(): Promise<void> {
  if (saving) return
  const now = currentView()
  if (!now) return
  // a slide that names a view (`camera: overview`) saves into that view; any other into the slide
  const target = namedTarget(shownFiles, now.index)
  saving = true
  try {
    if (target) await saveNamedView(target, now.view, now.rounded)
    else await saveSlideView(now.index, now.view, now.rounded)
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
  savedView = { ...rounded, expect: { path: 'slides.md', text: next } }
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
  savedView = { ...rounded, expect: { path: target.path, text: next } }
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

// ---- Save view as… (Shift+V, Scene Actions…; docs/scene-files.md) ----------------

/** the slides' cameras as the panel shows them (the running deck) */
async function shownCameras(): Promise<unknown[]> {
  const { default: deck } = await import('./deck-from-source')
  return deck.slides.map((s) => s.effective.camera)
}

/** the Save view as… choices for the slide shown; null without a scene */
async function choicesHere(): Promise<SaveAsChoices | null> {
  const engine = lysark()?.engine
  return engine ? saveAsChoices(shownFiles, engine.currentIndex, usersWith(await shownCameras())) : null
}

/**
 * Save the camera view by a Save view as… choice: into the slide alone, into
 * an existing view the slide then uses, or into a new view (and a new scene
 * file, if the lecture has none for the slide's scene). One edit, in up to two
 * files, applied only if neither changed since it was read.
 */
async function saveAs(choice: SaveAs, choices: SaveAsChoices): Promise<void> {
  if (saving) return
  const now = currentView()
  if (!now) return
  saving = true
  try {
    const read = await host.read(choices.exists ? ['slides.md', choices.path] : ['slides.md'], 'text')
    const slides = read['slides.md']
    const scene = choices.exists ? read[choices.path] : null
    for (const [path, file] of [['slides.md', slides], [choices.path, scene]] as const) {
      if (file && (typeof file.text !== 'string' || typeof file.version !== 'number')) {
        showBanner(`The view was not saved: ${path} could not be read (${file.error ?? 'no text'}).`)
        return
      }
    }
    const plan = saveAsChanges(
      shownFiles['slides.md'],
      { slides: slides.text!, scene: scene?.text ?? null },
      now.index,
      choices,
      choice,
      now.view,
    )
    if ('problem' in plan) {
      showBanner(`The view was not saved: ${plan.problem}`)
      return
    }
    if (!plan.slides && !plan.scene && !plan.create) {
      showBanner('Nothing to change: it is saved like that already', 'ok')
      return
    }
    const apply = (text: string, change: { start: number; end: number; text: string } | null) =>
      change ? text.slice(0, change.start) + change.text + text.slice(change.end) : text
    const before: Record<string, string> = { ...shownFiles, 'slides.md': slides.text! }
    if (scene) before[choices.path] = scene.text!
    const after: Record<string, string> = { ...before, 'slides.md': apply(slides.text!, plan.slides) }
    if (scene) after[choices.path] = apply(scene.text!, plan.scene)
    if (plan.create) after[choices.path] = plan.create
    const broken = problemWith(after)
    if (broken && !problemWith(before)) {
      showBanner(`The view was not saved: the slides would have an error:\n${broken}`)
      return
    }
    const changes: HostChange[] = []
    if (plan.slides) changes.push({ path: 'slides.md', version: slides.version!, ...plan.slides })
    if (plan.scene) changes.push({ path: choices.path, version: scene!.version!, ...plan.scene })
    if (plan.create) changes.push({ path: choices.path, create: plan.create })
    // slides.md comes last when the edit also makes a file (VS Code reports the file first)
    savedView = { ...now.rounded, expect: plan.slides ? { path: 'slides.md', text: after['slides.md'] } : { path: choices.path, text: after[choices.path] } }
    const result = await host.edit('Save camera view as', changes)
    if (!result.ok) {
      savedView = null
      showBanner(`The view was not saved: ${result.message ?? 'VS Code refused the edit'}`)
      return
    }
    const n = now.index + 1
    showSaved(
      choice.kind === 'slide'
        ? `Slide ${n} has its own camera view now`
        : choice.kind === 'view'
          ? `Slide ${n} uses the view '${choice.name}' now, changed to this camera in ${choices.path} (not saved yet)`
          : plan.create
            ? `New view '${choice.name}' in a new file, ${choices.path}; slide ${n} uses it`
            : `New view '${choice.name}' in ${choices.path} (not saved yet); slide ${n} uses it`,
    )
  } finally {
    saving = false
  }
}

/** the Save view as… dialog, if open */
let dialog: { close(): void } | null = null

/**
 * Shift+V: the panel's own dialog for Save view as… (VS Code's lists can't
 * open from a key pressed in the panel; docs/editor-host.md). Arrow keys
 * choose, Enter saves, Escape closes; the deck's keys wait meanwhile.
 */
async function openSaveAs(): Promise<void> {
  if (dialog || saving || !currentView()) return
  const choices = await choicesHere()
  if (!choices || dialog) return
  type Row = { label: string; detail: string; choice: SaveAs | 'new' }
  const rows: Row[] = [
    {
      label: 'Only this slide',
      detail: choices.current ? `its own camera, instead of the view '${choices.current}'` : 'its own camera, as V saves it',
      choice: { kind: 'slide' },
    },
    ...choices.views.map((v) => ({
      label: `The view '${v.name}'`,
      detail:
        (v.name === choices.current ? "this slide's view, as V saves it" : 'this slide uses it from now on') +
        (v.users.length > 0 ? ` · slides ${listSlides(v.users)}` : ''),
      choice: { kind: 'view', name: v.name } as SaveAs,
    })),
    { label: 'A new view', detail: choices.exists ? `in ${choices.path}` : `in a new file, ${choices.path}`, choice: 'new' },
  ]
  // what V doesn't do: the slide alone for a slide that names a view, otherwise a new view
  let selected = choices.current ? 0 : rows.length - 1

  const box = document.createElement('div')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Save this camera view')
  box.style.cssText =
    'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:1002;width:min(520px,calc(100vw - 24px));' +
    'max-height:calc(100vh - 56px);overflow:auto;box-sizing:border-box;' +
    'background:rgba(var(--surface-rgb),0.97);color:var(--text);border:1px solid var(--border-soft);border-radius:10px;' +
    'box-shadow:var(--shadow-text);font:14px/1.35 system-ui,sans-serif;padding:10px 10px 8px;outline:none'
  const title = document.createElement('div')
  title.textContent = 'Save this camera view'
  title.style.cssText = 'font-weight:600;margin:0 4px 2px'
  const keys = document.createElement('div')
  keys.textContent = '↑ ↓ choose · Enter save · Esc cancel'
  keys.style.cssText = 'color:var(--text-dim);font-size:12px;margin:0 4px 8px'
  const list = document.createElement('div')
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Where to save the camera view')
  list.tabIndex = -1
  list.style.outline = 'none'
  const input = document.createElement('input')
  input.placeholder = 'name, such as oversikt'
  input.setAttribute('aria-label', 'Name of the new view')
  input.spellcheck = false
  // typing a name is choosing a new view
  input.addEventListener('focus', () => {
    if (rows[selected].choice !== 'new') select(rows.length - 1)
  })
  input.style.cssText =
    'display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:3px 6px;border-radius:4px;font:inherit;' +
    'background:var(--bg);color:var(--text);border:1px solid var(--border-soft)'
  const problem = document.createElement('div')
  problem.style.cssText = 'color:var(--bad);font-size:12px;margin:6px 4px 0;min-height:1em'
  const rowEls = rows.map((row, i) => {
    const el = document.createElement('div')
    el.id = `lysark-save-as-${i}`
    el.setAttribute('role', 'option')
    el.style.cssText = 'padding:6px 8px;border-radius:6px;cursor:pointer'
    const label = document.createElement('div')
    label.textContent = row.label
    const detail = document.createElement('div')
    detail.textContent = row.detail
    detail.style.cssText = 'color:var(--text-dim);font-size:12px'
    el.append(label, detail)
    // a left click chooses (on release, so pressing and moving away doesn't)
    el.addEventListener('mousedown', (e) => {
      if (e.target === input || e.button !== 0) return
      e.preventDefault()
      select(i)
    })
    el.addEventListener('click', (e) => {
      if (e.target === input || e.button !== 0) return
      if (row.choice !== 'new') void apply()
    })
    list.append(el)
    return el
  })
  // the name field is under the list (an option's contents aren't fields to a screen reader)
  input.setAttribute('aria-describedby', rowEls[rowEls.length - 1].id)
  box.append(title, keys, list, input, problem)
  // a tap here isn't a tap on the slide (src/main.ts goes to the next slide on one)
  for (const type of ['pointerdown', 'pointerup'] as const) box.addEventListener(type, (e) => e.stopPropagation())
  document.body.append(box)

  function select(i: number): void {
    selected = (i + rows.length) % rows.length
    rowEls.forEach((el, k) => {
      el.style.background = k === selected ? 'var(--surface-hi2)' : 'transparent'
      el.style.boxShadow = k === selected ? 'inset 0 0 0 1px var(--accent)' : 'none'
      el.setAttribute('aria-selected', String(k === selected))
    })
    list.setAttribute('aria-activedescendant', rowEls[selected].id)
    rowEls[selected].scrollIntoView({ block: 'nearest' })
    problem.textContent = ''
    if (rows[selected].choice === 'new') {
      input.focus()
      input.scrollIntoView({ block: 'nearest' })
    } else list.focus()
  }
  async function apply(): Promise<void> {
    const row = rows[selected]
    // the files may have changed while the dialog was open: choose against them as they are now
    const now = await choicesHere()
    if (!now) return close()
    const say = (text: string) => {
      problem.textContent = text[0].toUpperCase() + text.slice(1)
    }
    if (row.choice === 'new') {
      const name = input.value.trim()
      const wrong = viewNameProblem(name, now.views.map((v) => v.name))
      if (wrong) {
        say(wrong)
        input.focus()
        return
      }
      close()
      return saveAs({ kind: 'new', name }, now)
    }
    const choice = row.choice
    if (choice.kind === 'view' && !now.views.some((v) => v.name === choice.name)) {
      say(`the view '${choice.name}' is no longer in ${now.path}; press Esc and Shift+V again`)
      return
    }
    close()
    return saveAs(choice, now)
  }
  // the dialog has the keys while open: arrows would change slides, and V
  // save. Not VS Code's shortcuts (Ctrl+S, F1, …), which go on to VS Code
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return
    e.stopImmediatePropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      select(selected + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void apply()
    }
  }
  const onSlide = () => close()
  function close(): void {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('hashchange', onSlide)
    box.remove()
    dialog = null
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('hashchange', onSlide)
  dialog = { close }
  select(selected)
}

window.addEventListener('keydown', (e) => {
  if ((e.key !== 'v' && e.key !== 'V') || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
  if (e.shiftKey) void openSaveAs()
  else void saveView()
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
