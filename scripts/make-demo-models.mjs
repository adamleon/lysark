// Writes the demo lecture's model files (docs/scene-files.md, "Models"),
// made from numbers here so they are our own and small: they ship in every
// course's copy of the engine, and CI shows them under Firefox's software
// OpenGL. Each is the kind of file a lecturer brings:
//
// - models/bracket.stl: an angle bracket as a CAD program exports it, binary
//   STL in millimetres with z up (the scene file says unit: mm and up: z);
// - models/tray.glb: a parts tray as Blender exports it, binary glTF in
//   metres with y up, two meshes with a colour of their own each and no
//   textures, its origin at a corner (the scene file needs neither unit nor
//   up, and shows its colours with material: file);
// - models/marker.glb: a box with a fiducial marker printed on each face, as
//   robot vision finds a part by, binary glTF with one PNG texture (the scene
//   file shows it with material: file);
// - models/sign.glb: a warning sign, one flat square whose PNG texture's
//   surround is transparent and cut out (alpha mode MASK, Blender's alpha
//   clip), so the sign and its shadow are a triangle.
//
// The files are committed; run this again only to change them:
//
//   node scripts/make-demo-models.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { binaryStl, box, faceNormal, glb, png } from '../src/scene/model-test-files.js'

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
 * A plastic colour as a glTF material: not metallic, so the stage, which has
 * no reflections, lights it as it lights a preset.
 * @param {string} name @param {[number, number, number]} linear glTF's colours are linear, not sRGB
 */
const plastic = (name, linear) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...linear, 1], metallicFactor: 0, roughnessFactor: 0.6 } })

/**
 * A parts tray, in metres with y up and its origin at a corner, as a model
 * made in Blender may be: an open box 160 by 100 mm and 30 mm high in teal,
 * and an orange divider on a node of its own, placed by the node's translation.
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
      { name: 'tray', triangles: body, material: 0 },
      { name: 'divider', triangles: divider, translation: [w / 2, t, d / 2], material: 1 },
    ],
    materials: [plastic('tray teal', [0.02, 0.3, 0.25]), plastic('divider orange', [0.9, 0.3, 0.03])],
  })
}

/**
 * A fiducial marker as robot vision reads one: 6 x 6 black and white cells
 * inside a black border, in a white margin, 8 pixels a cell (80 x 80 pixels).
 * The pattern is our own, not symmetric, so a face turned or mirrored shows.
 * @returns {ArrayBuffer} a PNG
 */
function markerImage() {
  const bits = ['100110', '011010', '110001', '001101', '101011', '010100']
  const cell = 8
  return png(10 * cell, 10 * cell, (x, y) => {
    const [cx, cy] = [Math.floor(x / cell), Math.floor(y / cell)]
    const margin = cx === 0 || cy === 0 || cx === 9 || cy === 9
    const border = !margin && (cx === 1 || cy === 1 || cx === 8 || cy === 8)
    const black = border || (!margin && bits[cy - 2][cx - 2] === '1')
    return black ? [20, 20, 22] : [245, 245, 240]
  })
}

/** a 60 mm cube with the marker on each face, standing on its origin, in metres with y up */
function marker() {
  return glb({
    meshes: [{ name: 'marker', triangles: box([-0.03, 0, -0.03], [0.03, 0.06, 0.03]), uvs: true, material: 0 }],
    materials: [{ name: 'printed marker', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    // nearest pixels up close, so the cells stay sharp; smooth mipmaps far away
    textures: [{ name: 'marker', bytes: markerImage(), sampler: { magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33071 } }],
  })
}

/**
 * A warning sign as an RGBA image, 64 x 64 pixels: a yellow triangle standing
 * on the image's bottom edge, with a black border and a black exclamation
 * mark. Its surround is transparent, and black, the colour the triangle's
 * edge blends into when the texture is filtered.
 * @returns {ArrayBuffer} a PNG
 */
function signImage() {
  const size = 64
  /** @type {Array<[number, number]>} the corners, in pixels from the top left: the apex, then the base on the bottom edge */
  const corners = [
    [32, 10],
    [63, 64],
    [1, 64],
  ]
  /** how far inside the edge from corner a to corner b the point is, in pixels (negative outside) */
  const inside = (/** @type {[number, number]} */ a, /** @type {[number, number]} */ b, /** @type {number} */ x, /** @type {number} */ y) =>
    ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1])
  const border = 5
  return png(
    size,
    size,
    (px, py) => {
      const [x, y] = [px + 0.5, py + 0.5]
      const depth = Math.min(...corners.map((a, k) => inside(a, corners[(k + 1) % 3], x, y)))
      if (depth < 0) return [0, 0, 0, 0]
      const mark = px >= 30 && px <= 33 && ((py >= 27 && py <= 47) || (py >= 51 && py <= 55))
      return depth < border || mark ? [20, 20, 22, 255] : [250, 196, 0, 255]
    },
    { alpha: true },
  )
}

/**
 * A warning sign 80 mm wide, standing on its origin, in metres with y up: one
 * square facing +z, seen from both sides, its texture's transparent surround
 * cut out (alpha mode MASK, at glTF's own cutoff, 0.5, as Blender writes alpha
 * clip from a Math node set to Round).
 */
function sign() {
  const [half, height] = [0.04, 0.08]
  return glb({
    meshes: [{ name: 'sign', triangles: quad([-half, 0, 0], [half, 0, 0], [half, height, 0], [-half, height, 0], [0, 0, 1]), uvs: true, material: 0 }],
    materials: [
      {
        name: 'warning sign',
        alphaMode: 'MASK',
        doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 },
      },
    ],
    textures: [{ name: 'warning', bytes: signImage() }],
  })
}

const files = {
  'bracket.stl': binaryStl(bracket(), { header: 'lysark demo: angle bracket, millimetres, z up' }),
  'tray.glb': tray(),
  'marker.glb': marker(),
  'sign.glb': sign(),
}
mkdirSync(MODELS, { recursive: true })
for (const [name, bytes] of Object.entries(files)) {
  const file = join(MODELS, name)
  writeFileSync(file, new Uint8Array(bytes))
  console.log(`${relative(ROOT, file).replace(/\\/g, '/')}: ${bytes.byteLength} bytes`)
}
