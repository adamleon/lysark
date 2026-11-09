import * as THREE from 'three'
import type { IkSolver } from '../scene/ik'

/**
 * The tool handle (docs/scene-files.md, step 5c): a ring over the robot's tool
 * while the joint sliders are open. Dragging it moves the tool in the plane
 * that faces the camera, through where the tool was when the drag began; the
 * scene's inverse kinematics finds the joints, which the runtime sets as the
 * sliders do. To move the tool nearer or farther, turn the view and drag
 * again. DOM over the canvas, in the VS Code panel only.
 */

/** what the handle needs of the scene shown; null when there is no tool to drag */
export interface ToolGrip {
  /** the robot and slide: a drag ends when they change */
  key: string
  camera: THREE.Camera
  /** the canvas the scene is drawn in: where the view is on screen */
  canvas: HTMLElement
  /** where the tool is now (world) */
  tool(): THREE.Vector3
  /** a drag begins: what moves the view under it (a camera flight) stops */
  begin(): void
  /** move the tool toward `target` (world); how far from it the tool is then (m) */
  moveTo(target: THREE.Vector3): number
}

export interface ToolHandle {
  /** follow the tool every frame (while the joint sliders are open), or hide and stop */
  setActive(on: boolean): void
}

/** the tool is there (m) */
const THERE = 0.001
/** a frame that brings the tool less nearer than this (m) is the edge of reach */
const NO_NEARER = 0.0002
/** the most a release spends on settling the tool (ms) */
const RELEASE_MS = 8

export function createToolHandle(grip: () => ToolGrip | null): ToolHandle {
  const el = document.createElement('div')
  el.className = 'lysark-tool-handle'
  el.title = "Drag to move the robot's tool"
  // the joint sliders are the way with the keyboard
  el.setAttribute('aria-hidden', 'true')
  // above the joint sliders (it may be under them in a narrow panel), below the Save … as dialog
  el.style.cssText =
    'position:fixed;z-index:1002;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;box-sizing:border-box;' +
    'border:2px solid var(--accent);background:rgba(var(--accent-rgb),0.25);cursor:grab;touch-action:none;display:none'
  document.addEventListener('DOMContentLoaded', () => document.body.append(el))
  if (document.readyState !== 'loading') document.body.append(el)

  let active = false
  let frame = 0
  /**
   * the drag in progress: the pointer that holds it, the robot and slide, its
   * plane, the grab point's offset from the tool, the pointer not yet
   * followed, and the point the tool is going to and how far it was from it
   */
  let drag: {
    id: number
    key: string
    plane: THREE.Plane
    offset: THREE.Vector3
    pointer: { x: number; y: number } | null
    target: THREE.Vector3 | null
    left: number
  } | null = null

  /** where a world point is on screen; null behind the camera */
  function screenOf(g: ToolGrip, p: THREE.Vector3): { x: number; y: number } | null {
    const ndc = p.clone().project(g.camera)
    if (ndc.z < -1 || ndc.z > 1) return null
    const rect = g.canvas.getBoundingClientRect()
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height }
  }

  /** the world point under the screen point (x, y) on `plane`; null if the ray misses it */
  function pointOn(g: ToolGrip, x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = g.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, g.camera)
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  /** the tool after the pointer: its latest place, then on toward it while it gets nearer */
  function follow(g: ToolGrip): void {
    if (!drag) return
    if (drag.pointer) {
      const p = pointOn(g, drag.pointer.x, drag.pointer.y, drag.plane)
      if (p) {
        drag.target = p.add(drag.offset)
        drag.left = Infinity
      }
      drag.pointer = null
    }
    if (drag.target) {
      // a fast move takes a few frames; it stops where the tool gets no nearer (the edge of reach)
      const left = g.moveTo(drag.target)
      if (left < THERE || drag.left - left < NO_NEARER) drag.target = null
      else drag.left = left
    }
  }

  function tick(): void {
    frame = 0
    if (!active) return
    const g = grip()
    // another slide or robot, or the slides' overview opened: the drag ends there
    if (drag && (!g || g.key !== drag.key)) end(false)
    if (g && drag) follow(g)
    const at = g ? screenOf(g, g.tool()) : null
    if (at) {
      el.style.display = 'block'
      el.style.left = `${at.x}px`
      el.style.top = `${at.y}px`
    } else el.style.display = 'none'
    frame = requestAnimationFrame(tick)
  }

  /**
   * The drag ends. `last`: a release; the tool still goes to where it was let
   * go (the pointer's last move, if no frame followed it yet), as near as it gets
   */
  function end(last: boolean): void {
    const g = last && drag ? grip() : null
    if (g && drag && g.key === drag.key) {
      // a few more steps toward where it was let go, within a few milliseconds (the page waits meanwhile)
      const until = performance.now() + RELEASE_MS
      follow(g)
      for (let k = 0; k < 20 && drag.target && performance.now() < until; k++) follow(g)
    }
    drag = null
    el.style.cursor = 'grab'
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
  }

  // only the pointer that holds the ring moves it (a second finger turns the view)
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    // the button let go outside the page
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return end(true)
    drag.pointer = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    end(e.type === 'pointerup')
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return
    const g = grip()
    if (!g) return
    // not a tap on the slide, nor the start of turning the view
    e.preventDefault()
    e.stopPropagation()
    g.begin()
    const tool = g.tool()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(g.camera.getWorldDirection(new THREE.Vector3()), tool)
    const grabbed = pointOn(g, e.clientX, e.clientY, plane)
    drag = {
      id: e.pointerId,
      key: g.key,
      plane,
      offset: grabbed ? tool.clone().sub(grabbed) : new THREE.Vector3(),
      pointer: null,
      target: null,
      left: Infinity,
    }
    try {
      el.setPointerCapture(e.pointerId) // the drag goes on outside the ring
    } catch {
      // a pointer the page can't capture: the window still hears it
    }
    el.style.cursor = 'grabbing'
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  })
  el.addEventListener('pointerup', (e) => e.stopPropagation())
  // capture lost without a release reaching the page
  el.addEventListener('lostpointercapture', (e) => {
    if (drag && e.pointerId === drag.id) end(false)
  })

  return {
    setActive(on: boolean) {
      active = on
      if (on && !frame) frame = requestAnimationFrame(tick)
      if (!on) {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        end(false)
        el.style.display = 'none'
      }
    },
  }
}

/** the farthest the tool aims in one step (m): a flick takes a few frames, each turning the joints a little */
const MAX_STEP = 0.03
/** a step that brings the tool less nearer than this (m) isn't taken */
const PROGRESS = 0.0001
/** the solve's own tolerance (m); nearer than twice this, there is no step to take */
const SOLVE_TOLERANCE = 0.0005
/** how near the elbow may come to straight (rad), from the side it is bent */
const BEND = 0.03
/** how far a joint is turned to try again from a straight arm (rad) */
const NUDGE = 0.05
/** how strongly the spare joints lean back toward the pose the drag began with, per iteration */
const REST_GAIN = 0.05

/**
 * One step of the tool toward `target` by inverse kinematics, from where the
 * robot is now: the joints the step takes it to, and how far the tool then is
 * from the target (m); null, the robot as it was, if no step gets nearer.
 *
 * Each step aims a few centimetres at most toward the pointer, so the joints
 * turn a little at a time, and the elbow is held bent the way it is (never
 * across straight, nor nearer straight than BEND): the solve may not turn it
 * past that. Past the edge of reach the solve can't take the tool outward, so
 * it takes it sideways, toward the pointer's direction: the tool slides along
 * the edge. An arm stretched straight can't tell which way to bend: from
 * there it tries again from each joint turned a little, the elbow first.
 *
 * A joint at its stop steps aside, and the others take the tool on. `rest`
 * (the pose before the author began dragging): the joints the tool doesn't
 * need, as the KUKA's wrist, lean back toward it, so dragging out and back
 * comes back to it; a few iterations without the lean finish each step.
 */
export function stepToward(
  ik: Pick<IkSolver, 'getJoints' | 'setJoints' | 'eePosition' | 'solve' | 'fk' | 'elbow'>,
  target: THREE.Vector3,
  rest?: Record<string, number>,
): { joints: Record<string, number>; left: number } | null {
  const before = ik.getJoints()
  const from = ik.eePosition()
  const was = from.distanceTo(target)
  // there; finer moves add up first (from below the solve's tolerance, a step could only come by
  // turning a joint off a straight arm, and creeping would walk a spare joint, as the KUKA's wrist)
  if (was <= 2 * SOLVE_TOLERANCE) return null
  const limits = elbowLimits(ik.elbow, before)
  const solve = (start: Record<string, number>, goal: THREE.Vector3) => {
    ik.setJoints(start)
    const aim = from.clone().add(goal.clone().sub(from).clampLength(0, MAX_STEP))
    const options = { tolerance: SOLVE_TOLERANCE, stopsAside: true, ...(limits ? { limits } : {}) }
    let joints = ik.solve(aim, { ...options, iterations: 12, ...(rest ? { rest, restGain: REST_GAIN } : {}) })
    // a few more without the lean, so it never leaves the tool short of the aim
    if (rest) joints = ik.solve(aim, { ...options, iterations: 4 })
    return { joints, at: ik.eePosition() }
  }
  let step: { joints: Record<string, number>; left: number } | null = null
  const first = solve(before, target)
  if (first.at.distanceTo(target) < was - PROGRESS) step = { joints: first.joints, left: first.at.distanceTo(target) }
  // a straight arm: from each joint turned a little, the elbow first, away from straight
  if (!step && first.at.distanceTo(from) < PROGRESS) {
    for (const [name, nudge] of nudges(before, ik.elbow)) {
      const start = { ...before, [name]: before[name] + nudge }
      if (ik.fk(start).distanceTo(from) < 1e-6) continue // a joint that doesn't move the tool
      const tried = solve(start, target)
      const left = tried.at.distanceTo(target)
      if (left < was - PROGRESS) {
        step = { joints: tried.joints, left }
        break
      }
    }
  }
  ik.setJoints(step ? step.joints : before)
  return step
}

/** the elbow's bounds for a solve: on the side it is bent, no nearer straight than BEND, or than it is */
function elbowLimits(elbow: IkSolver['elbow'], before: Record<string, number>): Record<string, [number, number]> | undefined {
  if (!elbow || before[elbow.joint] === undefined) return undefined
  const bent = before[elbow.joint] - elbow.straight
  if (Math.abs(bent) < 1e-9) return undefined
  const least = Math.min(BEND, Math.abs(bent))
  return { [elbow.joint]: bent > 0 ? [elbow.straight + least, Infinity] : [-Infinity, elbow.straight - least] }
}

/** the joints to turn a little to get off a straight arm: the elbow first, away from straight */
function nudges(before: Record<string, number>, elbow: IkSolver['elbow']): Array<[string, number]> {
  const out: Array<[string, number]> = []
  if (elbow && before[elbow.joint] !== undefined) {
    const bent = before[elbow.joint] - elbow.straight
    if (Math.abs(bent) > 1e-9) out.push([elbow.joint, Math.sign(bent) * NUDGE])
    else out.push([elbow.joint, NUDGE], [elbow.joint, -NUDGE])
  }
  for (const name of Object.keys(before)) if (name !== elbow?.joint) out.push([name, NUDGE], [name, -NUDGE])
  return out
}
