import * as THREE from 'three'
import { MAX_METRES } from '../compiler/scene-files'
import { placeNode } from '../scene/objects'
import { placeText, type ObjectPlace, type Vec3 } from './object-edit'

/**
 * The object handles (M, docs/scene-files.md, "Moving objects in the editor";
 * step 7 of docs/scene-files-proposal.md): a ring on each object of the scene
 * shown, with its name, and a dot beside it. Dragging the ring moves the
 * object along the floor, or up and down with Shift held; dragging the dot
 * around the ring turns it about the vertical. The object moves at once, to
 * the centimetre and the whole degree, as the file will say; letting go
 * hands its place to the runtime, which writes it into the scene file
 * (object-edit.ts). A small panel lists the objects and where each is. DOM
 * over the canvas, in the VS Code panel only.
 */

/** an object the handles can move */
export interface HandleObject {
  name: string
  /** its node in the running scene (its anchor) */
  node: THREE.Object3D
  /** where it is: as the file says, or as a drag left it on its way into the file */
  place: ObjectPlace
  /** how far up its own y its ring sits: the middle of a shape, 0 for a frame or a point */
  middle: number
  /** a dot to turn it: not for an invisible point with nothing on it */
  turnable: boolean
}

/** what the handles show; a new `key` (another slide, scene or set of objects) builds them afresh */
export interface ObjectsState {
  key: string
  objects: HandleObject[]
  /** why there is nothing to move, or how to move */
  note: string
  /** where a move is written */
  footer?: string
  /** the view the rings are drawn over; none: the panel alone (the slides' overview is open, say) */
  view?: { camera: THREE.Camera; canvas: HTMLElement }
  /** a drag begins: what moves the view under it (a camera flight) stops */
  begin?(): void
  /** a drag ended with the object (`node`) moved: write `place` (it was at `from`) */
  release?(name: string, place: ObjectPlace, from: ObjectPlace, node: THREE.Object3D): void
}

export interface ObjectHandles {
  readonly open: boolean
  toggle(): void
  /** the object being dragged, if any: text arriving meanwhile leaves it where the pointer has it */
  dragging(): string | null
}

const UP = new THREE.Vector3(0, 1, 0)
/** the dot's distance from the middle of its ring (px) */
const KNOB_RADIUS = 26
/** nearer the ring's middle than this (px), the pointer's direction around it is too unsteady to turn by */
const DEAD_ZONE = 8
/** a view this near level with the ring (the sine of 10 degrees) sees the floor's plane edge-on */
const EDGE_ON = 0.17
/** a press whose pointer goes no farther than this (px) is a click: it moves nothing */
const CLICK = 3

/** metres as the panel writes them: to the centimetre (no -0) */
export function toCentimetre(v: number): number {
  const r = Number(v.toFixed(2))
  return r === 0 ? 0 : r
}

/** degrees as the panel writes them: whole (no -0) */
export function toDegree(v: number): number {
  const r = Math.round(v)
  return r === 0 ? 0 : r
}

const mod = (x: number, m: number) => ((x % m) + m) % m
/** degrees into (-180, 180] */
const wrap180 = (v: number) => {
  const w = mod(v + 180, 360) - 180
  return w === -180 ? 180 : w
}

/**
 * `at` for an object whose origin is moved to `world`, in its parent's frame
 * (`parentWorld`, the parent's world matrix): each coordinate the move
 * changed to the centimetre, each it didn't as it was (`from`).
 */
export function movedAt(parentWorld: THREE.Matrix4, from: Vec3, world: THREE.Vector3): Vec3 {
  const local = world.clone().applyMatrix4(parentWorld.clone().invert())
  return [local.x, local.y, local.z].map((v, k) => (Math.abs(v - from[k]) < 1e-9 ? from[k] : toCentimetre(v))) as Vec3
}

/**
 * `rotate` (degrees, x then y then z) for an object at `from` turned
 * `degrees` about the vertical, in its parent's frame (`parentWorld`, the
 * parent's world turn). Of the two ways to write a turn as x, y and z, the
 * one nearest `from`; each angle the turn changed to the whole degree, in
 * (-180, 180], each it didn't as it was. So `rotate: 48` turned 2 degrees is
 * 50, and an object on a robot's base, `[90, 30, 0]`, becomes [90, 32, 0].
 */
export function turnedRotate(parentWorld: THREE.Quaternion, from: Vec3, degrees: number): Vec3 {
  if (degrees === 0) return from
  const rad = THREE.MathUtils.degToRad
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(from[0]), rad(from[1]), rad(from[2]), 'XYZ'))
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, rad(degrees))
  const q = parentWorld.clone().invert().multiply(turn).multiply(parentWorld).multiply(q0)
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  const a = [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg)
  const b = [a[0] + 180, 180 - a[1], a[2] + 180]
  // each angle as near the one it was as a whole turn more or less makes it
  const near = (v: number, k: number) => from[k] + mod(v - from[k] + 180, 360) - 180
  const A = a.map(near)
  const B = b.map(near)
  const cost = (X: number[]) => X.reduce((sum, v, k) => sum + Math.abs(v - from[k]), 0)
  const best = cost(B) < cost(A) - 1e-9 ? B : A
  // rounded before it is wrapped, so -179.6 is written 180, not -180
  return best.map((v, k) => (Math.abs(v - from[k]) < 1e-6 ? from[k] : toDegree(wrap180(Math.round(v))))) as Vec3
}

/**
 * The way the object faces along the floor, for its dot (world): its own x
 * flattened onto the floor, or, if x points more up or down than along it,
 * the flatter of its z and y. (A turn about the vertical changes none of
 * these lengths, so the dot keeps to one axis while the object turns.)
 */
export function heading(node: THREE.Object3D): THREE.Vector3 {
  const q = node.getWorldQuaternion(new THREE.Quaternion())
  const flat = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).setY(0)
  // (a margin, so an exact tie, as a laid-down object's z and y, isn't decided by rounding noise)
  const x = flat(1, 0, 0)
  if (x.length() >= Math.SQRT1_2 - 1e-6) return x.normalize()
  const z = flat(0, 0, 1)
  const y = flat(0, 1, 0)
  return (z.length() >= y.length() - 1e-6 ? z : y).normalize()
}

/** a drag in progress */
interface Drag {
  id: number
  key: string
  name: string
  node: THREE.Object3D
  mode: 'move' | 'turn'
  from: ObjectPlace
  place: ObjectPlace
  release: ObjectsState['release']
  /**
   * the parent's frame when the drag began (world): the place is worked out
   * in it, so a parent that moves meanwhile (a robot's tool on an idle slide)
   * doesn't move the object's at, nor makes a press without a move one
   */
  parentWorld: THREE.Matrix4
  parentTurn: THREE.Quaternion
  /** moving: up and down (Shift), or along the floor */
  vertical: boolean
  /** moving: the origin (world) and the point grabbed on the plane the ring moves in, when the plane was set */
  origin: THREE.Vector3
  grabbed: THREE.Vector3
  plane: THREE.Plane
  /**
   * turning: the turn's axis on screen (at the ring's height: it stays put while
   * the object turns, as a laid-down shape's ring goes round it), the pointer's
   * last direction around it and the turn so far (rad)
   */
  center: { x: number; y: number }
  /** turning: where the pointer is, where the dot is drawn */
  pointer: { x: number; y: number }
  /** where the pointer was pressed, and the farthest it has gone from there (px) */
  press: { x: number; y: number }
  travelled: number
  angle: number | null
  swept: number
  /** turning: +1 if the view is from below the ring (a turn on screen is the other way round) */
  sign: number
}

export function createObjectHandles(read: () => ObjectsState, top: () => number): ObjectHandles {
  // the panel: a list of the objects and where each is, at the top right as the joint sliders
  const box = document.createElement('div')
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', 'Objects')
  box.style.cssText =
    'position:fixed;right:12px;top:44px;z-index:1001;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 120px);' +
    'overflow:auto;box-sizing:border-box;display:none;background:rgba(var(--surface-rgb),0.94);color:var(--text);' +
    'border:1px solid var(--border-soft);border-radius:10px;box-shadow:var(--shadow-text);font:13px/1.35 system-ui,sans-serif;' +
    'padding:8px 10px'
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px'
  const title = document.createElement('div')
  title.textContent = 'Objects'
  title.style.fontWeight = '600'
  const close = document.createElement('button')
  close.textContent = '×'
  close.title = 'Close (M)'
  close.setAttribute('aria-label', 'Close the objects')
  close.style.cssText = 'background:none;border:none;color:var(--text-dim);font:18px/1 system-ui,sans-serif;cursor:pointer;padding:0 2px'
  close.addEventListener('click', () => toggle())
  // Space and Enter press the button; the deck would take Space as "next slide"
  close.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
  })
  head.append(title, close)
  const note = document.createElement('div')
  note.style.cssText = 'color:var(--text-dim);font-size:12px;margin:2px 0 6px'
  const list = document.createElement('div')
  const footer = document.createElement('div')
  footer.style.cssText = 'color:var(--text-dim);font-size:12px;margin-top:6px'
  box.append(head, note, list, footer)
  // the rings, over the canvas, under the Save … as dialog
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:1002'
  // a tap here isn't a tap on the slide (src/main.ts goes to the next slide on one)
  for (const el of [box, layer]) for (const type of ['pointerdown', 'pointerup'] as const) el.addEventListener(type, (e) => e.stopPropagation())
  const mount = () => document.body.append(box, layer)
  document.addEventListener('DOMContentLoaded', mount)
  if (document.readyState !== 'loading') mount()

  let opened = false
  let frame = 0
  let key: string | null = null
  let state: ObjectsState | null = null
  let drag: Drag | null = null
  let handles: Array<{ object: string; ring: HTMLElement; knob: HTMLElement; label: HTMLElement; row: HTMLElement; value: HTMLElement }> = []

  function build(s: ObjectsState): void {
    if (drag) end(true) // another slide or scene: the drag ends where it got to
    key = s.key
    handles = s.objects.map((o) => {
      const ring = document.createElement('div')
      ring.className = 'lysark-object-handle'
      ring.dataset.object = o.name
      ring.title = `Drag to move '${o.name}' along the floor; with Shift, up and down`
      // the scene file is the way with the keyboard
      ring.setAttribute('aria-hidden', 'true')
      ring.style.cssText =
        'position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;box-sizing:border-box;display:none;' +
        'border:2px solid var(--accent);background:rgba(var(--accent-rgb),0.25);cursor:move;touch-action:none'
      const knob = document.createElement('div')
      knob.className = 'lysark-object-knob'
      knob.dataset.object = o.name
      knob.title = `Drag around the ring to turn '${o.name}' about the vertical`
      knob.setAttribute('aria-hidden', 'true')
      knob.style.cssText =
        'position:fixed;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;box-sizing:border-box;display:none;' +
        'background:var(--accent);border:1px solid var(--bg);cursor:grab;touch-action:none'
      const label = document.createElement('div')
      label.textContent = o.name
      label.setAttribute('aria-hidden', 'true')
      label.style.cssText =
        'position:fixed;display:none;font:11px/1.2 system-ui,sans-serif;color:var(--text);pointer-events:none;white-space:nowrap;' +
        'text-shadow:0 0 3px var(--bg),0 0 3px var(--bg)'
      ring.addEventListener('pointerdown', (e) => start(e, o.name, 'move', ring))
      knob.addEventListener('pointerdown', (e) => start(e, o.name, 'turn', knob))
      for (const el of [ring, knob]) {
        el.addEventListener('lostpointercapture', (e) => {
          if (drag && e.pointerId === drag.id) end(true)
        })
      }
      const row = document.createElement('div')
      row.style.cssText = 'margin:3px 0'
      const name = document.createElement('div')
      name.textContent = o.name
      const value = document.createElement('div')
      value.style.cssText = 'color:var(--text-dim);font-size:11px;font-variant-numeric:tabular-nums'
      row.append(name, value)
      return { object: o.name, ring, knob, label, row, value }
    })
    layer.replaceChildren(...handles.flatMap((h) => [h.label, h.ring, h.knob]))
    list.replaceChildren(...handles.map((h) => h.row))
  }

  /** where a world point is on screen; null behind the camera */
  function screenOf(view: NonNullable<ObjectsState['view']>, p: THREE.Vector3): { x: number; y: number } | null {
    const ndc = p.clone().project(view.camera)
    if (ndc.z < -1 || ndc.z > 1) return null
    const rect = view.canvas.getBoundingClientRect()
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height }
  }

  /** the world point under the screen point (x, y) on `plane`; null if the ray misses it */
  function pointOn(view: NonNullable<ObjectsState['view']>, x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = view.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, view.camera)
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  /** where the object's ring is (world): the middle of its shape, or its origin */
  const ringPoint = (o: { node: THREE.Object3D; middle: number }) => o.node.localToWorld(new THREE.Vector3(0, o.middle, 0))

  /** the view sees a plane through `through` with this normal edge-on (within about 10 degrees) */
  function edgeOn(view: NonNullable<ObjectsState['view']>, through: THREE.Vector3, normal: THREE.Vector3): boolean {
    const toRing = through.clone().sub(view.camera.getWorldPosition(new THREE.Vector3())).normalize()
    return Math.abs(toRing.dot(normal)) < EDGE_ON
  }

  /**
   * the plane a move goes in, through the ring: the floor's (level), or
   * (vertical) the upright one that faces the view most. Seen from about the
   * ring's height the floor's plane is edge-on, where a pixel is metres: a
   * level move then goes in the upright plane too, and keeps its height
   * (follow), so it goes sideways only
   */
  function planeFor(view: NonNullable<ObjectsState['view']>, through: THREE.Vector3, vertical: boolean): THREE.Plane {
    if (!vertical && !edgeOn(view, through, UP)) return new THREE.Plane().setFromNormalAndCoplanarPoint(UP, through)
    const facing = view.camera.getWorldDirection(new THREE.Vector3()).setY(0)
    // looking straight down: the way up the screen points along the floor
    if (facing.lengthSq() < 1e-6) facing.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(view.camera.quaternion)).setY(0)
    if (facing.lengthSq() < 1e-6) facing.set(0, 0, 1)
    return new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), through)
  }

  function objectOf(name: string): HandleObject | undefined {
    return state?.objects.find((o) => o.name === name)
  }

  function start(e: PointerEvent, name: string, mode: Drag['mode'], el: HTMLElement): void {
    if (e.button !== 0 || drag || !state?.view) return
    const o = objectOf(name)
    if (!o?.node.parent) return
    // not a tap on the slide, nor the start of turning the view
    e.preventDefault()
    e.stopPropagation()
    state.begin?.()
    const view = state.view
    const parent = o.node.parent
    parent.updateWorldMatrix(true, false)
    const ring = ringPoint(o)
    const plane = planeFor(view, ring, e.shiftKey)
    const origin = o.node.getWorldPosition(new THREE.Vector3())
    const center = screenOf(view, new THREE.Vector3(origin.x, ring.y, origin.z)) ?? { x: e.clientX, y: e.clientY }
    const camera = view.camera.getWorldPosition(new THREE.Vector3())
    drag = {
      id: e.pointerId,
      key: state.key,
      name,
      node: o.node,
      mode,
      from: { at: [...o.place.at], rotate: [...o.place.rotate] },
      place: { at: [...o.place.at], rotate: [...o.place.rotate] },
      release: state.release,
      parentWorld: parent.matrixWorld.clone(),
      parentTurn: parent.getWorldQuaternion(new THREE.Quaternion()),
      vertical: e.shiftKey,
      origin,
      grabbed: pointOn(view, e.clientX, e.clientY, plane) ?? ring,
      plane,
      center,
      pointer: { x: e.clientX, y: e.clientY },
      press: { x: e.clientX, y: e.clientY },
      travelled: 0,
      angle: null,
      swept: 0,
      sign: camera.y < ring.y ? 1 : -1,
    }
    if (mode === 'turn') aim(e.clientX, e.clientY)
    try {
      el.setPointerCapture(e.pointerId) // the drag goes on outside the ring
    } catch {
      // a pointer the page can't capture: the window still hears it
    }
    el.style.cursor = mode === 'turn' ? 'grabbing' : 'move'
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('keydown', onKey, true)
  }

  /** turning: follow the pointer's direction around the ring */
  function aim(x: number, y: number): void {
    if (!drag) return
    drag.pointer = { x, y }
    const dx = x - drag.center.x
    const dy = y - drag.center.y
    if (dx * dx + dy * dy < DEAD_ZONE * DEAD_ZONE) return
    const angle = Math.atan2(dy, dx)
    if (drag.angle !== null) {
      let d = angle - drag.angle
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      drag.swept += d
    }
    drag.angle = angle
  }

  /** the drag follows the pointer at (x, y) */
  function follow(x: number, y: number, shift: boolean): void {
    const view = state?.view
    if (!drag || !view) return
    drag.travelled = Math.max(drag.travelled, Math.hypot(x - drag.press.x, y - drag.press.y))
    // within a click's wobble nothing moves yet (the turn keeps count of the pointer's way round)
    if (drag.travelled < CLICK) {
      if (drag.mode === 'turn') aim(x, y)
      return
    }
    if (drag.mode === 'turn') {
      aim(x, y)
      // on screen (y down) a sweep the clock's way, seen from above, is a turn the clock's way: about -y
      const degrees = toDegree((drag.sign * drag.swept * 180) / Math.PI)
      const rotate = turnedRotate(drag.parentTurn, drag.from.rotate, degrees)
      drag.place = { at: drag.place.at, rotate }
    } else {
      if (shift !== drag.vertical) {
        // Shift pressed or let go: on from where the object is now, in the other plane
        const o = objectOf(drag.name)
        const ring = o ? ringPoint(o) : drag.node.getWorldPosition(new THREE.Vector3())
        drag.vertical = shift
        drag.plane = planeFor(view, ring, shift)
        drag.origin = new THREE.Vector3(...drag.place.at).applyMatrix4(drag.parentWorld)
        drag.grabbed = pointOn(view, x, y, drag.plane) ?? ring
      }
      // up and down seen from straight above (or below): the upright plane is edge-on, where a
      // pixel is metres, so the height stays (look from lower down to move it up or down)
      if (drag.vertical && edgeOn(view, drag.grabbed, drag.plane.normal)) return
      const hit = pointOn(view, x, y, drag.plane)
      if (!hit) return
      const delta = hit.sub(drag.grabbed)
      if (drag.vertical) delta.set(0, delta.y, 0)
      else delta.y = 0
      const at = movedAt(drag.parentWorld, drag.from.at, drag.origin.clone().add(delta))
      // the scene file takes no farther (its numbers would be millimetres): the object stops
      if (at.some((v) => Math.abs(v) > MAX_METRES)) return
      drag.place = { at, rotate: drag.place.rotate }
    }
    placeNode(drag.node, drag.place)
  }

  /** the drag ends: `keep` the object where it is, and have it written (a release), or put it back */
  function end(keep: boolean): void {
    const d = drag
    drag = null
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    window.removeEventListener('keydown', onKey, true)
    for (const h of handles) {
      h.ring.style.cursor = 'move'
      h.knob.style.cursor = 'grab'
    }
    if (!d) return
    // a click moves nothing, whatever a pixel's worth of plane would have made of it
    const moved = d.travelled >= CLICK && JSON.stringify(d.place) !== JSON.stringify(d.from)
    if (keep && moved) d.release?.(d.name, d.place, d.from, d.node)
    // back where the runtime has it now (a move before this one may have been refused meanwhile)
    else placeNode(d.node, objectOf(d.name)?.place ?? d.from)
  }

  // only the pointer that holds the handle moves it (a second finger turns the view)
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    // the button let go outside the page
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return end(true)
    follow(e.clientX, e.clientY, e.shiftKey)
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    if (e.type === 'pointerup') follow(e.clientX, e.clientY, e.shiftKey)
    end(e.type === 'pointerup')
  }
  // Esc while dragging puts the object back; the deck doesn't hear it
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !drag) return
    e.preventDefault()
    e.stopImmediatePropagation()
    end(false)
  }

  function tick(): void {
    frame = 0
    if (!opened) return
    const s = read()
    if (s.key !== key) build(s)
    state = s
    note.textContent = s.note
    footer.textContent = s.footer ?? ''
    footer.style.display = s.footer ? 'block' : 'none'
    const at = top()
    box.style.top = `${at}px`
    box.style.maxHeight = `calc(100vh - ${at + 76}px)`
    for (const h of handles) {
      const o = objectOf(h.object)
      const place = drag?.name === h.object ? drag.place : o?.place
      const text = place ? placeText(place) : ''
      if (h.value.textContent !== text) h.value.textContent = text
      const view = s.view
      const p = view && o ? screenOf(view, ringPoint(o)) : null
      for (const el of [h.ring, h.label]) el.style.display = p ? 'block' : 'none'
      h.knob.style.display = p && o?.turnable ? 'block' : 'none'
      if (!p || !o || !view) continue
      h.ring.style.left = `${p.x}px`
      h.ring.style.top = `${p.y}px`
      h.label.style.left = `${p.x + 12}px`
      h.label.style.top = `${p.y + 8}px`
      // the dot: while turning, under the pointer; otherwise beside the ring, the way the object faces
      if (drag?.name === h.object && drag.mode === 'turn') {
        h.knob.style.left = `${drag.pointer.x}px`
        h.knob.style.top = `${drag.pointer.y}px`
        continue
      }
      const ahead = screenOf(view, ringPoint(o).add(heading(o.node).multiplyScalar(0.1)))
      const angle = ahead && Math.hypot(ahead.x - p.x, ahead.y - p.y) > 1 ? Math.atan2(ahead.y - p.y, ahead.x - p.x) : 0
      h.knob.style.left = `${p.x + KNOB_RADIUS * Math.cos(angle)}px`
      h.knob.style.top = `${p.y + KNOB_RADIUS * Math.sin(angle)}px`
    }
    frame = requestAnimationFrame(tick)
  }

  function toggle(): void {
    opened = !opened
    box.style.display = opened ? 'block' : 'none'
    layer.style.display = opened ? 'block' : 'none'
    if (opened) {
      key = null
      if (!frame) frame = requestAnimationFrame(tick)
    } else {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (drag) end(true)
      for (const h of handles) for (const el of [h.ring, h.knob, h.label]) el.style.display = 'none'
    }
  }

  return {
    get open() {
      return opened
    },
    toggle,
    dragging: () => drag?.name ?? null,
  }
}
