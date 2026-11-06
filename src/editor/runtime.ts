import { compileLecture } from '../compiler/compile-slides'
import type { CameraTargetSpec } from '../engine/slide-types'
import { SCENE_NAMES } from '../scenes/registry'
import { viewNameProblem, type CameraView } from './camera-edit'
import { compileForEditor, updateTargets } from './editor-compile'
import { createHost, type HostChange } from './host'
import { createJointPanel, type PanelState } from './joint-panel'
import { loadImages } from './panel-images'
import { EDITOR_PROTOCOL } from './panel-page.js'
import {
  motionOf,
  namedPoseEdit,
  poseAsChanges,
  poseJointValue,
  poseAsChoices,
  poseEdit,
  poseNameProblem,
  poseTarget,
  poseUsers,
  poseValue,
  sceneJoints,
  type PoseAsChoices,
  type PoseTarget,
  type SavePoseAs,
} from './pose-edit'
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
 * once and 'shown', as is text that only changes joints (a saved pose). Other
 * new text that compiles is 'accepted', and the
 * extension then loads the panel afresh and sends that text again on 'ready'.
 * Text that doesn't compile leaves the last good version running and shows
 * the error.
 *
 * Every set of files the extension sends carries a number (seq). The page
 * names the one it shows in 'shown' and 'slide', so the extension knows which
 * text a slide number counts in. Saving a view is computed here and written
 * through the extension's edit request (host.ts, save-view.ts), as is
 * saving the robot's pose (P; pose-edit.ts, joint-panel.ts).
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
/** a joint of the robot shown (engine/motion-system.ts, PidChannel) */
interface JointChannel {
  x: number
  v: number
  setpoint: number
  pid: { reset(): void }
}
interface LysarkHandle {
  sceneLayer: { camera: { position: Vec3Like } }
  controls: { target: Vec3Like }
  cameraCtl: { active: boolean; lookTarget: Vec3Like }
  engine: {
    currentIndex: number
    slideCount: number
    current: {
      scene?: string
      effective: { camera?: { lookAt?: unknown; spring?: { omega?: number; zeta?: number } }; joints?: Record<string, number> }
      trajectory?: unknown
      idle?: Record<string, unknown>
    }
    goTo(index: number, direction?: 'forward' | 'backward'): void
  }
  sceneManager: {
    busy: boolean
    activeSceneId: string | undefined
    active: {
      anchors: Record<string, { getWorldPosition(v: Vec3Like): Vec3Like }>
      channels: Record<string, JointChannel>
      defaults: { joints?: Record<string, number> }
    } | null
  }
  /** run the render loop until the scene settles */
  ensureTicking(): void
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

/**
 * the last pose saved from this page: the slide and its scene, the joints
 * written, the file text its edit makes, which uses it up (as savedView), and
 * when VS Code took the edit
 */
let savedPose: {
  slide: number
  scene: string
  values: Record<string, number>
  expect: { path: string; text: string }
  at: number
} | null = null
/** P waits this long for the last pose saved to come back in the text, then saves anyway */
const POSE_PENDING_MS = 10_000
/**
 * the joints moved with the sliders, per scene, and where to: the engine
 * leaves a joint that no slide sets where it is, so such a move stays on the
 * next slides, and P writes it there. It is forgotten once the joint is
 * elsewhere (a slide, idle or a trajectory moved it) or its pose is saved.
 */
const jogged = new Map<string, Map<string, number>>()
/** a pose is being read and written (between P and VS Code's answer) */
let savingPose = false

const round2 = (n: number) => Number(n.toFixed(2))

/** the joints whose values differ between `a` and `b` (set in one only, too) */
function changedJoints(a: Record<string, number> | undefined, b: Record<string, number> | undefined): string[] {
  const names = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  return [...names].filter((name) => a?.[name] !== b?.[name])
}

/**
 * Put new text into the running deck without loading the page afresh, if
 * only cameras and joints changed. The slide on screen may only change to the
 * view or the pose just saved from it (the camera, the robot, is already
 * there); any other change to it needs the fresh page, where the camera flies
 * to it.
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
  // likewise its joints: only to the pose just saved, on its slide or carried
  // onto the slide shown (P, then on to the next slide before the text came)
  const nowJoints = deck.slides[i]?.effective.joints
  const nextJoints = fresh[i]?.effective.joints
  const changed = changedJoints(nowJoints, nextJoints)
  const posesSlideShown = changed.length > 0
  const pose = savedPose
  const fromSavedPose =
    pose !== null && fresh[i]?.scene === pose.scene && changed.every((joint) => nextJoints?.[joint] !== undefined && nextJoints[joint] === pose.values[joint])
  if (posesSlideShown && !fromSavedPose) return false
  // the slide shown runs its trajectory from the ends it had when it was entered
  if (JSON.stringify(fresh[i]?.trajectory) !== JSON.stringify(deck.slides[i]?.trajectory)) return false
  if (updateTargets(deck.slides, fresh) === null) return false
  // the saved view is used up once its edit's text has come (or it was put on
  // the slide shown). Until then it waits: files in between (VS Code reports a
  // file the edit creates before the edit's own text comes) mustn't use it up
  const expect = savedView?.expect
  if ((expect && files[expect.path] === expect.text) || (changesSlideShown && isSavedView)) savedView = null
  if (posesSlideShown && pose) {
    // On the slide saved, the robot is at the pose already, up to the two
    // decimals written; on a slide that carries it, it goes there, as entering
    // the slide would have taken it. A joint the sliders moved since stays
    // where it is, and still counts as moved
    const active = lysark()?.sceneManager.active
    const joints = sceneJoints(pose.scene)
    for (const joint of changed) {
      const channel = active?.channels[joint]
      const info = joints.find((j) => j.name === joint)
      const value = nextJoints![joint]
      if (!channel || !info) continue
      const was = nowJoints?.[joint] ?? active?.defaults.joints?.[joint]
      if (poseValue(channel.setpoint, info) === value || was === undefined || Math.abs(channel.setpoint - was) < 1e-9) channel.setpoint = value
    }
    lysark()?.ensureTicking()
  }
  const poseExpect = savedPose?.expect
  if (savedPose && ((poseExpect && files[poseExpect.path] === poseExpect.text) || (posesSlideShown && fromSavedPose))) {
    // the joints saved are written now: moves with the sliders not made since are done
    const moved = jogged.get(savedPose.scene)
    const joints = sceneJoints(savedPose.scene)
    for (const [joint, value] of Object.entries(savedPose.values)) {
      const at = moved?.get(joint)
      const info = joints.find((j) => j.name === joint)
      if (at !== undefined && info && poseValue(at, info) === value) moved!.delete(joint)
    }
    savedPose = null
  }
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
hint.textContent =
  'Ctrl+S in the text updates the preview · V or the camera button above: save this camera view into the slide · Shift+V: save as… · J: pose the robot'
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
    ' · Shift+V: save as… · J: pose the robot'
  hint.textContent = text([])
  // and the joint sliders say where P writes
  const pose = engine ? poseTarget(shownFiles, engine.currentIndex) : null
  const poseText = (users: number[]) =>
    pose
      ? `P: change the pose '${pose.pose}' in ${pose.path}` + (users.length > 1 ? ` (slides ${listSlides(users)} use it)` : '') + ' · Shift+P: save as…'
      : `P: save this pose into slide ${(index ?? 0) + 1} · Shift+P: save as…`
  jointPanel.setFooter(poseText([]))
  window.clearTimeout(hintTimer)
  if (!target && !pose) return
  const seq = shownSeq
  hintTimer = window.setTimeout(async () => {
    const here = () => shownSeq === seq && lysark()?.engine.currentIndex === index
    if (target) {
      const users = await flyingTo(target)
      if (here()) hint.textContent = text(users)
    }
    if (pose) {
      const users = await posedBy(pose)
      if (here()) jointPanel.setFooter(poseText(users))
    }
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
        savedPose = null
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
      savedPose = null
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
      items.push({ label: 'Save view as: only this slide', description: `its own camera, instead of the view '${choices.current}'`, value: 'slide' })
    }
    for (const v of choices.views) {
      if (v.name === choices.current) continue
      items.push({
        label: `Save view as: the view '${v.name}'`,
        description: 'this slide uses it from now on' + (v.users.length > 0 ? `; now on slides ${listSlides(v.users)}` : ''),
        value: `view:${v.name}`,
      })
    }
    items.push({ label: 'Save view as: a new view…', description: choices.exists ? `in ${choices.path}` : `creates ${choices.path}`, value: 'new' })
  }
  const poses = engine?.current.scene && !movesItself(engine.current) ? await poseChoicesHere() : null
  if (engine && poses) {
    const pose = poseTarget(shownFiles, engine.currentIndex)
    const posers = pose ? await posedBy(pose) : []
    items.push({
      label: pose ? `Change the pose '${pose.pose}' to the robot's pose` : "Save the robot's pose into this slide",
      description: pose ? `P, in ${pose.path}` + (posers.length > 1 ? `; slides ${listSlides(posers)} use it` : '') : 'P',
      value: 'save-pose',
    })
    if (poses.current) {
      items.push({ label: 'Save pose as: only this slide', description: `its own joints, instead of the pose '${poses.current}'`, value: 'pose-slide' })
    }
    for (const p of poses.poses) {
      if (p.name === poses.current) continue
      items.push({
        label: `Save pose as: the pose '${p.name}'`,
        description: 'this slide uses it from now on' + (p.users.length > 0 ? `; now on slides ${listSlides(p.users)}` : ''),
        value: `pose:${p.name}`,
      })
    }
    items.push({ label: 'Save pose as: a new pose…', description: poses.exists ? `in ${poses.path}` : `creates ${poses.path}`, value: 'pose-new' })
  }
  const asked = engine?.currentIndex
  const choice = await host.ask({ title: 'Lysark: scene actions', items })
  if (choice === 'save-view') return saveView()
  if (choice === 'save-pose') return savePose()
  if (choice && poses) {
    // the files, the slide or a pose may have changed while VS Code asked:
    // save against the choices as they are now, as the Shift+P dialog does
    const now = async (): Promise<PoseAsChoices | null> => {
      const fresh = lysark()?.engine.currentIndex === asked ? await poseChoicesHere() : null
      if (!fresh) showBanner('The pose was not saved: the slide changed meanwhile; choose again.')
      return fresh
    }
    if (choice === 'pose-slide') {
      const fresh = await now()
      return fresh ? savePoseAs({ kind: 'slide' }, fresh) : undefined
    }
    if (choice.startsWith('pose:')) {
      const name = choice.slice(5)
      const fresh = await now()
      if (fresh && !fresh.poses.some((p) => p.name === name)) {
        return showBanner(`The pose was not saved: the pose '${name}' is no longer in ${fresh.path}.`)
      }
      return fresh ? savePoseAs({ kind: 'pose', name }, fresh) : undefined
    }
    if (choice === 'pose-new') {
      let prompt = "The new pose's name: one word, such as 'q0'"
      for (;;) {
        const answer = await host.ask({ title: 'Lysark: new pose', input: { prompt, placeholder: 'q0' } })
        if (answer === null) return
        const name = answer.trim()
        const fresh = await now()
        if (!fresh) return
        const problem = poseNameProblem(name, fresh.poses.map((p) => p.name))
        if (!problem) return savePoseAs({ kind: 'new', name }, fresh)
        prompt = `${problem[0].toUpperCase()}${problem.slice(1)}. Try another name.`
      }
    }
  }
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

// ---- pose the robot (J, P; docs/scene-files.md) ---------------------------

/** why the robot on this slide can't be posed, if it can't: the slide moves it itself */
function movesItself(slide: LysarkHandle['engine']['current']): string | null {
  if (slide.trajectory) return 'this slide moves the robot along its trajectory'
  if (slide.idle && Object.keys(slide.idle).length > 0) return 'this slide moves the robot itself (idle:)'
  return null
}

/**
 * Whether P writes this joint on the slide shown: it is away from where the
 * slide puts it (its own joints, carried ones, a pose, the scene's), or the
 * slide puts it nowhere and the sliders moved it.
 */
function jointMoved(slide: LysarkHandle['engine']['current'], active: NonNullable<LysarkHandle['sceneManager']['active']>, name: string): boolean {
  const channel = active.channels[name]
  if (!channel) return false
  const target = slide.effective.joints?.[name] ?? active.defaults.joints?.[name]
  if (target !== undefined) return Math.abs(channel.setpoint - target) > 1e-9
  // no slide puts it anywhere: moved if the sliders left it where it is
  const moved = jogged.get(slide.scene ?? '')
  const at = moved?.get(name)
  if (at === undefined) return false
  if (Math.abs(channel.setpoint - at) < 1e-9) return true
  moved!.delete(name) // something else has moved it since
  return false
}

/** the joint sliders: one per joint of the robot shown, which move it at once */
const jointPanel = createJointPanel((): PanelState => {
  const L = lysark()
  if (!L) return { key: 'loading', joints: [], note: 'The slides are starting.' }
  const slide = L.engine.current
  const index = L.engine.currentIndex
  if (!slide.scene) return { key: `${index}`, joints: [], note: 'This slide has no 3D scene, so there is no robot to pose.' }
  const active = L.sceneManager.active
  if (L.sceneManager.busy || L.sceneManager.activeSceneId !== slide.scene || !active) {
    return { key: `${index}:loading`, joints: [], note: 'The scene is loading…' }
  }
  const why = movesItself(slide)
  const joints = sceneJoints(slide.scene)
    .filter((j) => active.channels[j.name])
    .map((j) => {
      const channel = active.channels[j.name]
      return {
        name: j.name,
        min: Math.ceil(j.min * 100 - 1e-6) / 100,
        max: Math.floor(j.max * 100 + 1e-6) / 100,
        get: () => channel.setpoint,
        set: (value: number) => {
          // at once, as a teach pendant jogs it, whatever gains the slide teaches with
          channel.setpoint = value
          channel.x = value
          channel.v = 0
          channel.pid.reset()
          if (!jogged.has(slide.scene!)) jogged.set(slide.scene!, new Map())
          jogged.get(slide.scene!)!.set(j.name, value)
          L.ensureTicking()
        },
        moved: () => jointMoved(slide, active, j.name),
      }
    })
  // (text put in place changes no row: what would reloads the panel)
  return { key: `${index}:${slide.scene}`, joints, ...(why ? { note: `${why[0].toUpperCase()}${why.slice(1)}, so it can't be posed here.` } : {}) }
}, () => (hint.isConnected ? Math.max(44, hint.getBoundingClientRect().bottom + 6) : 44))

/**
 * What a slide shows of the robot, to tell whether a save changes it: the
 * joints the engine puts (the scene's `defaults` under the slide's, in any
 * order; those its trajectory drives left out), and its trajectory.
 */
function robotShown(slide: { effective: { joints?: Record<string, number> }; trajectory?: unknown }, defaults: Record<string, number>): string {
  const joints: Record<string, number> = { ...defaults, ...slide.effective.joints }
  const driven = (slide.trajectory as { from?: Record<string, number> } | undefined)?.from ?? {}
  const put = Object.keys(joints)
    .filter((name) => !(name in driven))
    .sort()
    .map((name) => [name, joints[name]])
  return JSON.stringify([put, slide.trajectory ?? null])
}

/** how the slides move the robot as the panel shows them (the running deck) */
async function shownMotions(): Promise<string[]> {
  const { default: deck } = await import('./deck-from-source')
  return deck.slides.map(motionOf)
}

/** the slides whose robot the pose moves, worked out once per pose and text (a compile) */
let posersOf: { seq: number | null; lists: Map<string, number[]> } = { seq: null, lists: new Map() }
async function posedBy(target: PoseTarget): Promise<number[]> {
  return posersWith(await shownMotions())(target)
}
function posersWith(motions: string[]): (target: PoseTarget) => number[] {
  return (target) => {
    if (posersOf.seq !== shownSeq) posersOf = { seq: shownSeq, lists: new Map() }
    const key = `${target.path}\n${target.pose}`
    if (!posersOf.lists.has(key)) posersOf.lists.set(key, poseUsers(shownFiles, target, motions))
    return posersOf.lists.get(key)!
  }
}

/**
 * The robot's pose on the slide shown: every joint as a pose writes it, and
 * the joints moved (jointMoved). A moved joint is written to two decimals,
 * inside its limits; one that isn't, as the slide (or the scene) puts it,
 * unless that is outside its limits. null, saying why, if it can't be saved.
 */
function robotPose(): {
  index: number
  scene: string
  robot: Record<string, number>
  moved: string[]
  defaults: Record<string, number>
} | null {
  const L = lysark()
  if (!L) return null
  const slide = L.engine.current
  if (!slide.scene) {
    showBanner('This slide has no 3D scene, so there is no pose to save.')
    return null
  }
  const active = L.sceneManager.active
  if (L.sceneManager.busy || L.sceneManager.activeSceneId !== slide.scene || !active) {
    showBanner('The scene is still loading; try again in a moment.')
    return null
  }
  const why = movesItself(slide)
  if (why) {
    showBanner(`The pose was not saved: ${why}.`)
    return null
  }
  const robot: Record<string, number> = {}
  const moved: string[] = []
  for (const joint of sceneJoints(slide.scene)) {
    const channel = active.channels[joint.name]
    if (!channel) continue
    const target = slide.effective.joints?.[joint.name] ?? active.defaults.joints?.[joint.name]
    const isMoved = jointMoved(slide, active, joint.name)
    if (isMoved) moved.push(joint.name)
    robot[joint.name] = poseJointValue(joint, channel.setpoint, target, isMoved)
  }
  return { index: L.engine.currentIndex, scene: slide.scene, robot, moved, defaults: { ...(active.defaults.joints ?? {}) } }
}

/**
 * The pose P saves on the slide shown: the joints moved, as written. null,
 * saying why, if there is nothing to save.
 */
function currentPose(): { index: number; scene: string; values: Record<string, number> } | null {
  const pose = robotPose()
  if (!pose) return null
  if (pose.moved.length === 0) {
    showBanner('No joint has moved on this slide: move one with the joint sliders (J), then press P.', 'ok')
    return null
  }
  return { index: pose.index, scene: pose.scene, values: Object.fromEntries(pose.moved.map((j) => [j, pose.robot[j]])) }
}

/**
 * A pose is being saved, or its text hasn't come back yet: a second save now
 * would reload the panel (one at a time). Says so.
 */
function posePending(): boolean {
  if (!savingPose && !(savedPose && performance.now() - savedPose.at < POSE_PENDING_MS)) return false
  showBanner('The last pose is still on its way into the slides; try again in a moment.', 'ok')
  return true
}

async function savePose(): Promise<void> {
  if (posePending()) return
  if (saving) return // a view is being saved
  const now = currentPose()
  if (!now) return
  // a slide that names a pose (`joints: reach`) saves into that pose; any other into the slide
  const target = poseTarget(shownFiles, now.index)
  saving = true
  savingPose = true
  try {
    if (target) await saveNamedPose(target, now)
    else await saveSlidePose(now)
  } finally {
    saving = false
    savingPose = false
  }
}

/** the pose into the slide's own `joints:` in slides.md */
async function saveSlidePose(now: NonNullable<ReturnType<typeof currentPose>>): Promise<void> {
  const file = (await host.read(['slides.md'], 'text'))['slides.md']
  if (typeof file.text !== 'string' || typeof file.version !== 'number') {
    showBanner(`The pose was not saved: slides.md could not be read (${file.error ?? 'no text'}).`)
    return
  }
  const change = poseEdit(shownFiles['slides.md'], file.text, now.index, now.values)
  if (change && 'problem' in change) {
    showBanner(`The pose was not saved: ${change.problem}`)
    return
  }
  if (!change) {
    showBanner(`Slide ${now.index + 1} already has this pose`, 'ok')
    return
  }
  const next = file.text.slice(0, change.start) + change.text + file.text.slice(change.end)
  const broken = problemWith({ ...shownFiles, 'slides.md': next })
  if (broken && !problemWith({ ...shownFiles, 'slides.md': file.text })) {
    showBanner(`The pose was not saved: the slides would have an error:\n${broken}`)
    return
  }
  savedPose = { slide: now.index, scene: now.scene, values: now.values, expect: { path: 'slides.md', text: next }, at: performance.now() }
  const result = await host.edit('Save robot pose', [{ path: 'slides.md', version: file.version, ...change }])
  if (!result.ok) {
    savedPose = null
    showBanner(`The pose was not saved: ${result.message ?? 'VS Code refused the edit'}`)
    return
  }
  if (savedPose) savedPose.at = performance.now() // its text comes after VS Code's answer
  showSaved(`Pose saved to slide ${now.index + 1}`)
}

/** the pose into the named pose the slide uses, in the lecture's scene file (docs/scene-files.md) */
async function saveNamedPose(target: PoseTarget, now: NonNullable<ReturnType<typeof currentPose>>): Promise<void> {
  const file = (await host.read([target.path], 'text'))[target.path]
  if (typeof file.text !== 'string' || typeof file.version !== 'number') {
    showBanner(`The pose was not saved: ${target.path} could not be read (${file.error ?? 'no text'}).`)
    return
  }
  const order = sceneJoints(now.scene).map((j) => j.name)
  const change = namedPoseEdit(file.text, target.pose, now.values, order)
  if (change && 'problem' in change) {
    showBanner(`The pose was not saved: ${change.problem}`)
    return
  }
  if (!change) {
    showBanner(`The pose '${target.pose}' already is this pose`, 'ok')
    return
  }
  const next = file.text.slice(0, change.start) + change.text + file.text.slice(change.end)
  const before = { ...shownFiles, [target.path]: file.text }
  const after = { ...shownFiles, [target.path]: next }
  const broken = problemWith(after)
  if (broken && !problemWith(before)) {
    showBanner(`The pose was not saved: the slides would have an error:\n${broken}`)
    return
  }
  // every slide whose robot moves with it: the slides that name it, those that carry it on, trajectories
  let changed: number[] = []
  try {
    const was = compileLecture(before['slides.md'], before).slides.map(motionOf)
    const is = compileLecture(after['slides.md'], after).slides.map(motionOf)
    changed = is.flatMap((m, i) => (m !== was[i] ? [i] : []))
  } catch {
    // the shown slides with the scene file as it is now don't compile: name none
  }
  savedPose = { slide: now.index, scene: now.scene, values: now.values, expect: { path: target.path, text: next }, at: performance.now() }
  const result = await host.edit(`Save robot pose '${target.pose}'`, [{ path: target.path, version: file.version, ...change }])
  if (!result.ok) {
    savedPose = null
    showBanner(`The pose was not saved: ${result.message ?? 'VS Code refused the edit'}`)
    return
  }
  if (savedPose) savedPose.at = performance.now() // its text comes after VS Code's answer
  showSaved(
    `Pose '${target.pose}' changed in ${target.path}, not saved yet (File > Save All)` +
      (changed.length > 0 ? `: slide${changed.length > 1 ? 's' : ''} ${listSlides(changed)} now take${changed.length > 1 ? '' : 's'} it` : ''),
  )
}

// ---- Save pose as… (Shift+P, Scene Actions…; docs/scene-files.md) ----------

/** the Save pose as… choices for the slide shown; null without a scene */
async function poseChoicesHere(): Promise<PoseAsChoices | null> {
  const engine = lysark()?.engine
  return engine ? poseAsChoices(shownFiles, engine.currentIndex, posersWith(await shownMotions())) : null
}

/**
 * Save the robot's pose by a Save pose as… choice: into the slide alone, into
 * an existing pose the slide then uses, or into a new pose (and a new scene
 * file, if the lecture has none for the slide's scene). One edit, in up to two
 * files, applied only if neither changed since it was read.
 */
async function savePoseAs(choice: SavePoseAs, choices: PoseAsChoices): Promise<void> {
  if (saving || posePending()) return
  const pose = robotPose()
  if (!pose) return
  saving = true
  savingPose = true
  try {
    const read = await host.read(choices.exists ? ['slides.md', choices.path] : ['slides.md'], 'text')
    const slides = read['slides.md']
    const scene = choices.exists ? read[choices.path] : null
    for (const [path, file] of [['slides.md', slides], [choices.path, scene]] as const) {
      if (file && (typeof file.text !== 'string' || typeof file.version !== 'number')) {
        showBanner(`The pose was not saved: ${path} could not be read (${file.error ?? 'no text'}).`)
        return
      }
    }
    const plan = poseAsChanges(
      shownFiles['slides.md'],
      { slides: slides.text!, scene: scene?.text ?? null },
      pose.index,
      choices,
      choice,
      pose.robot,
      pose.moved,
    )
    if ('problem' in plan) {
      showBanner(`The pose was not saved: ${plan.problem}`)
      return
    }
    if (!plan.slides && !plan.scene && !plan.create) {
      showBanner(
        choice.kind === 'slide' && !choices.current
          ? 'No joint has moved on this slide: move one with the joint sliders (J), then save.'
          : 'Nothing to change: it is saved like that already',
        'ok',
      )
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
      showBanner(`The pose was not saved: the slides would have an error:\n${broken}`)
      return
    }
    // the other slides whose robot moves with it: users of the pose, and those that carry the slide on
    // (worked out on the text the panel shows, so the numbers are the panel's)
    let others: number[] = []
    try {
      const shownSlides = shownFiles['slides.md']
      const current = { slides: shownSlides, scene: scene?.text ?? null }
      const onShown = poseAsChanges(shownSlides, current, pose.index, choices, choice, pose.robot, pose.moved)
      if (!('problem' in onShown)) {
        const was: Record<string, string> = { ...shownFiles }
        if (scene) was[choices.path] = scene.text!
        const is: Record<string, string> = { ...was, 'slides.md': apply(shownSlides, onShown.slides) }
        if (scene) is[choices.path] = apply(scene.text!, onShown.scene)
        if (onShown.create) is[choices.path] = onShown.create
        const shows = (files: Record<string, string>) =>
          compileLecture(files['slides.md'], files).slides.map((s) => (s.scene === pose.scene ? robotShown(s, pose.defaults) : motionOf(s)))
        const a = shows(was)
        const b = shows(is)
        others = b.flatMap((m, i) => (m !== a[i] && i !== pose.index ? [i] : []))
      }
    } catch {
      // the slides as they are now don't compile: name none
    }
    const alsoChanged = others.length > 0 ? `; slide${others.length > 1 ? 's' : ''} ${listSlides(others)} change${others.length > 1 ? '' : 's'} with it` : ''
    const changes: HostChange[] = []
    if (plan.slides) changes.push({ path: 'slides.md', version: slides.version!, ...plan.slides })
    if (plan.scene) changes.push({ path: choices.path, version: scene!.version!, ...plan.scene })
    if (plan.create) changes.push({ path: choices.path, create: plan.create })
    // slides.md comes last when the edit also makes a file (VS Code reports the file first)
    savedPose = {
      slide: pose.index,
      scene: pose.scene,
      values: plan.written,
      expect: plan.slides ? { path: 'slides.md', text: after['slides.md'] } : { path: choices.path, text: after[choices.path] },
      at: performance.now(),
    }
    const result = await host.edit('Save robot pose as', changes)
    if (!result.ok) {
      savedPose = null
      showBanner(`The pose was not saved: ${result.message ?? 'VS Code refused the edit'}`)
      return
    }
    if (savedPose) savedPose.at = performance.now() // its text comes after VS Code's answer
    const n = pose.index + 1
    showSaved(
      (choice.kind === 'slide'
        ? `Slide ${n} has its own joints now`
        : choice.kind === 'pose'
          ? plan.scene
            ? `Slide ${n} uses the pose '${choice.name}' now, changed to this pose in ${choices.path} (not saved yet)`
            : `Slide ${n} uses the pose '${choice.name}' now (it already is this pose)`
          : plan.create
            ? `New pose '${choice.name}' in a new file, ${choices.path}; slide ${n} uses it`
            : `New pose '${choice.name}' in ${choices.path} (not saved yet); slide ${n} uses it`) + alsoChanged,
    )
  } finally {
    saving = false
    savingPose = false
  }
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

/** the Save view as… or Save pose as… dialog, if open */
let dialog: { close(): void } | null = null

/** a row of a Save … as dialog: a choice, or the new name typed under the list */
interface DialogRow<C> {
  label: string
  detail: string
  choice: C | 'new'
}

/**
 * The panel's own dialog for Save view as… and Save pose as… (VS Code's lists
 * can't open from a key pressed in the panel; docs/editor-host.md). Arrow keys
 * choose, Enter saves, Escape closes; the deck's keys wait meanwhile. `apply`
 * saves the choice, closing the dialog first, or returns why it can't.
 */
function openChoiceDialog<C>(spec: {
  title: string
  listLabel: string
  inputLabel: string
  placeholder: string
  rows: DialogRow<C>[]
  selected: number
  apply(choice: C | 'new', name: string, close: () => void): Promise<string | void>
}): void {
  const rows = spec.rows
  let selected = spec.selected
  // the focus goes back where it was when the dialog closes (a joint slider, say)
  const opener = document.activeElement
  const box = document.createElement('div')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', spec.title)
  box.style.cssText =
    'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:1002;width:min(520px,calc(100vw - 24px));' +
    'max-height:calc(100vh - 56px);overflow:auto;box-sizing:border-box;' +
    'background:rgba(var(--surface-rgb),0.97);color:var(--text);border:1px solid var(--border-soft);border-radius:10px;' +
    'box-shadow:var(--shadow-text);font:14px/1.35 system-ui,sans-serif;padding:10px 10px 8px;outline:none'
  const title = document.createElement('div')
  title.textContent = spec.title
  title.style.cssText = 'font-weight:600;margin:0 4px 2px'
  const keys = document.createElement('div')
  keys.textContent = '↑ ↓ choose · Enter save · Esc cancel'
  keys.style.cssText = 'color:var(--text-dim);font-size:12px;margin:0 4px 8px'
  const list = document.createElement('div')
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', spec.listLabel)
  list.tabIndex = -1
  list.style.outline = 'none'
  const input = document.createElement('input')
  input.placeholder = spec.placeholder
  input.setAttribute('aria-label', spec.inputLabel)
  input.spellcheck = false
  // typing a name is choosing the new one
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
    const choice = rows[selected].choice
    const wrong = await spec.apply(choice, input.value.trim(), close)
    if (!wrong) return
    problem.textContent = wrong[0].toUpperCase() + wrong.slice(1)
    if (choice === 'new') input.focus()
  }
  // the dialog has the keys while open: arrows would change slides, and V or P
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
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus()
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('hashchange', onSlide)
  dialog = { close }
  select(selected)
}

/** Shift+V: Save view as…, in the panel's own dialog */
async function openSaveAs(): Promise<void> {
  if (dialog || saving || !currentView()) return
  const choices = await choicesHere()
  if (!choices || dialog) return
  const rows: DialogRow<SaveAs>[] = [
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
  openChoiceDialog<SaveAs>({
    title: 'Save this camera view',
    listLabel: 'Where to save the camera view',
    inputLabel: 'Name of the new view',
    placeholder: 'name, such as oversikt',
    rows,
    // what V doesn't do: the slide alone for a slide that names a view, otherwise a new view
    selected: choices.current ? 0 : rows.length - 1,
    async apply(choice, name, close) {
      // the files may have changed while the dialog was open: choose against them as they are now
      const now = await choicesHere()
      if (!now) return close()
      if (choice === 'new') {
        const wrong = viewNameProblem(name, now.views.map((v) => v.name))
        if (wrong) return wrong
        close()
        return saveAs({ kind: 'new', name }, now)
      }
      if (choice.kind === 'view' && !now.views.some((v) => v.name === choice.name)) {
        return `the view '${choice.name}' is no longer in ${now.path}; press Esc and Shift+V again`
      }
      close()
      return saveAs(choice, now)
    },
  })
}

/** Shift+P: Save pose as…, in the panel's own dialog */
async function openSavePoseAs(): Promise<void> {
  if (dialog || saving || posePending() || !robotPose()) return
  const choices = await poseChoicesHere()
  if (!choices || dialog) return
  const rows: DialogRow<SavePoseAs>[] = [
    {
      label: 'Only this slide',
      detail: choices.current ? `its own joints, instead of the pose '${choices.current}'` : 'its own joints, as P saves them',
      choice: { kind: 'slide' },
    },
    ...choices.poses.map((p) => ({
      label: `The pose '${p.name}'`,
      detail:
        (p.name === choices.current ? "this slide's pose, as P saves it" : 'this slide uses it from now on') +
        (p.users.length > 0 ? ` · slides ${listSlides(p.users)}` : ''),
      choice: { kind: 'pose', name: p.name } as SavePoseAs,
    })),
    {
      label: 'A new pose',
      detail: (choices.exists ? `in ${choices.path}` : `in a new file, ${choices.path}`) + ', every joint',
      choice: 'new',
    },
  ]
  openChoiceDialog<SavePoseAs>({
    title: "Save the robot's pose",
    listLabel: "Where to save the robot's pose",
    inputLabel: 'Name of the new pose',
    placeholder: 'name, such as q0',
    rows,
    // what P doesn't do: the slide alone for a slide that names a pose, otherwise a new pose
    selected: choices.current ? 0 : rows.length - 1,
    async apply(choice, name, close) {
      const now = await poseChoicesHere()
      if (!now) return close()
      if (choice === 'new') {
        const wrong = poseNameProblem(name, now.poses.map((p) => p.name))
        if (wrong) return wrong
        close()
        return savePoseAs({ kind: 'new', name }, now)
      }
      if (choice.kind === 'pose' && !now.poses.some((p) => p.name === choice.name)) {
        return `the pose '${choice.name}' is no longer in ${now.path}; press Esc and Shift+P again`
      }
      close()
      return savePoseAs(choice, now)
    },
  })
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // not while typing; a slider (the joints', a slide's) has no use for letters
  if (e.target instanceof HTMLElement && e.target.closest('input:not([type="range"]), textarea, select')) return
  const key = e.key.toLowerCase()
  if (key === 'v') {
    if (e.shiftKey) void openSaveAs()
    else void saveView()
  } else if (key === 'p') {
    if (e.shiftKey) void openSavePoseAs()
    else void savePose()
  } else if (key === 'j' && !e.shiftKey) {
    jointPanel.toggle()
  }
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
