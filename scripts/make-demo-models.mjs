// Writes the demo lecture's two model files (docs/scene-files.md, "Models"),
// made from numbers here so they are our own and small: they ship in every
// course's copy of the engine, and CI shows them under Firefox's software
// OpenGL. Each is the kind of file a lecturer brings:
//
// - models/bracket.stl: an angle bracket as a CAD program exports it, binary
//   STL in millimetres with z up (the scene file says unit: mm and up: z);
// - models/tray.glb: a parts tray as Blender exports it, binary glTF in
//   metres with y up, two meshes and no materials, its origin at a corner
//   (the scene file needs neither unit nor up).
//
// The files are committed; run this again only to change them:
//
//   node scripts/make-demo-models.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { binaryStl, box, faceNormal, glb } from '../src/scene/model-test-files.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = join(ROOT, 'lectures/demo/models')

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[Vec3, Vec3, Vec3]} Triangle */

/**
 * The triangle a-b-c, wound to face `outward`.
 * @param {Vec3} a @param {Vec3} b @param {Vec3} c @param {Vec3} outward
 * @returns {Triangle}
 */
function facing(a, b, c, outward) {
  const n = faceNormal([a, b, c])
  return n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] >= 0 ? [a, b, c] : [a, c, b]
}

/**
 * The quad a-b-c-d as two triangles, facing `outward`.
 * @param {Vec3} a @param {Vec3} b @param {Vec3} c @param {Vec3} d @param {Vec3} outward
 * @returns {Triangle[]}
 */
const quad = (a, b, c, d, outward) => [facing(a, b, c, outward), facing(a, c, d, outward)]

/**
 * A flat plate in its own frame (u, v across it, w through it from 0 to
 * `thickness`): `tiles` squares of side `side` in a row along u, centred on
 * u = 0, each with a round hole through its middle. The hole's edge is a
 * polygon of `segments` sides, a multiple of 8, so that the square's corners
 * are among the points the plate's faces are made of.
 * @param {{ tiles: number, side: number, thickness: number, radius: number, segments: number }} options
 * @returns {Triangle[]}
 */
function holedPlate({ tiles, side, thickness, radius, segments }) {
  const half = side / 2
  /** @type {Triangle[]} */
  const out = []
  for (let t = 0; t < tiles; t++) {
    const cu = (t - (tiles - 1) / 2) * side
    /** @type {(k: number, onSquare: boolean, w: number) => Vec3} */
    const point = (k, onSquare, w) => {
      const a = (2 * Math.PI * k) / segments
      const [c, s] = [Math.cos(a), Math.sin(a)]
      if (!onSquare) return [cu + radius * c, radius * s, w]
      // out along the same direction to the square's edge: the larger of u and v exactly at the edge
      return Math.abs(c) >= Math.abs(s) ? [cu + Math.sign(c) * half, (half * s) / Math.abs(c), w] : [cu + (half * c) / Math.abs(s), Math.sign(s) * half, w]
    }
    for (let k = 0; k < segments; k++) {
      const mid = (2 * Math.PI * (k + 0.5)) / segments
      /** @type {Vec3} */
      const towardAxis = [-Math.cos(mid), -Math.sin(mid), 0]
      out.push(
        ...quad(point(k, false, thickness), point(k + 1, false, thickness), point(k + 1, true, thickness), point(k, true, thickness), [0, 0, 1]),
        ...quad(point(k, false, 0), point(k + 1, false, 0), point(k + 1, true, 0), point(k, true, 0), [0, 0, -1]),
        ...quad(point(k, false, 0), point(k + 1, false, 0), point(k + 1, false, thickness), point(k, false, thickness), towardAxis),
      )
    }
  }
  // the plate's four edges, each one face
  const [u0, u1] = [(-tiles * side) / 2, (tiles * side) / 2]
  /** @type {(u: number, v: number, w: number) => Vec3} */
  const p = (u, v, w) => [u, v, w]
  out.push(
    ...quad(p(u0, -half, 0), p(u1, -half, 0), p(u1, -half, thickness), p(u0, -half, thickness), [0, -1, 0]),
    ...quad(p(u0, half, 0), p(u1, half, 0), p(u1, half, thickness), p(u0, half, thickness), [0, 1, 0]),
    ...quad(p(u0, -half, 0), p(u0, half, 0), p(u0, half, thickness), p(u0, -half, thickness), [-1, 0, 0]),
    ...quad(p(u1, -half, 0), p(u1, half, 0), p(u1, half, thickness), p(u1, -half, thickness), [1, 0, 0]),
  )
  return out
}

/**
 * The triangles with each corner mapped by `f`, a turn and a shift (no mirror,
 * so they still face out).
 * @param {Triangle[]} triangles @param {(v: Vec3) => Vec3} f
 * @returns {Triangle[]}
 */
const mapped = (triangles, f) => triangles.map(([a, b, c]) => [f(a), f(b), f(c)])

/**
 * An angle bracket, in millimetres with z up: a leg lying on z = 0 and a leg
 * standing at its back edge (y from 0 to the thickness), each with two holes,
 * and a web between them in the middle. 80 mm wide, 46 mm deep, 40 mm tall.
 * @returns {Triangle[]}
 */
function bracket() {
  const side = 40
  const thickness = 6
  const plate = holedPlate({ tiles: 2, side, thickness, radius: 7, segments: 16 })
  // the lying leg: u along x, v along y in front of the standing leg, w up
  const lying = mapped(plate, ([u, v, w]) => [u, thickness + side / 2 + v, w])
  // the standing leg: u along x, v up, w backwards from its front face (a turn about x)
  const standing = mapped(plate, ([u, v, w]) => [u, thickness - w, side / 2 + v])
  // the web: a triangle in the y-z plane, 5 mm thick, in the corner between the legs
  const [x0, x1] = [-2.5, 2.5]
  const reach = 18
  /** @type {(x: number, y: number, z: number) => Vec3} */
  const p = (x, y, z) => [x, y, z]
  const [a, b, c] = [
    [thickness, thickness],
    [thickness + reach, thickness],
    [thickness, thickness + reach],
  ]
  const slope = Math.SQRT1_2
  const web = [
    facing(p(x0, ...a), p(x0, ...b), p(x0, ...c), [-1, 0, 0]),
    facing(p(x1, ...a), p(x1, ...b), p(x1, ...c), [1, 0, 0]),
    ...quad(p(x0, ...a), p(x1, ...a), p(x1, ...b), p(x0, ...b), [0, 0, -1]),
    ...quad(p(x0, ...a), p(x1, ...a), p(x1, ...c), p(x0, ...c), [0, -1, 0]),
    ...quad(p(x0, ...b), p(x1, ...b), p(x1, ...c), p(x0, ...c), [0, slope, slope]),
  ]
  return [...lying, ...standing, ...web]
}

/**
 * A parts tray, in metres with y up and its origin at a corner, as a model
 * made in Blender may be: an open box 160 by 100 mm and 30 mm high, and a
 * divider on a node of its own, placed by the node's translation.
 */
function tray() {
  const [w, h, d, t] = [0.16, 0.03, 0.1, 0.004]
  const body = [
    ...box([0, 0, 0], [w, t, d]),
    ...box([0, t, 0], [t, h, d]),
    ...box([w - t, t, 0], [w, h, d]),
    ...box([t, t, 0], [w - t, h, t]),
    ...box([t, t, d - t], [w - t, h, d]),
  ]
  const divider = box([-0.002, 0, -(d / 2 - t)], [0.002, 0.022, d / 2 - t])
  return glb({
    meshes: [
      { name: 'tray', triangles: body },
      { name: 'divider', triangles: divider, translation: [w / 2, t, d / 2] },
    ],
  })
}

const files = {
  'bracket.stl': binaryStl(bracket(), { header: 'lysark demo: angle bracket, millimetres, z up' }),
  'tray.glb': tray(),
}
mkdirSync(MODELS, { recursive: true })
for (const [name, bytes] of Object.entries(files)) {
  const file = join(MODELS, name)
  writeFileSync(file, new Uint8Array(bytes))
  console.log(`${relative(ROOT, file).replace(/\\/g, '/')}: ${bytes.byteLength} bytes`)
}
