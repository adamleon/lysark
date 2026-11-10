// @ts-check
// Model files made from numbers, for the tests of models in scene files
// (docs/scene-files.md, "Models") and for scripts/make-demo-models.mjs, which
// writes the demo lecture's models with them. Plain JavaScript with no
// imports, so a Node script can use it without a build, and only what both
// Node and browsers have (no Buffer), so the bytes are the same everywhere.
//
// Every builder returns an ArrayBuffer of exactly the file's bytes, which is
// what the loaders and the checks take. Write one with
// writeFileSync(path, new Uint8Array(bytes)).

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[Vec3, Vec3, Vec3]} Triangle three corners, counter-clockwise seen from outside */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
/** @param {Vec3} a @param {Vec3} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The unit normal of a triangle, from its winding; [0, 0, 0] for one with no area.
 * @param {Triangle} triangle
 * @returns {Vec3}
 */
export function faceNormal(triangle) {
  const [a, b, c] = triangle
  const n = cross(minus(b, a), minus(c, a))
  const length = Math.hypot(...n)
  return length > 0 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 0]
}

/**
 * Two triangles for the quad a-b-c-d, wound to face `outward`.
 * @param {Vec3} a @param {Vec3} b @param {Vec3} c @param {Vec3} d
 * @param {Vec3} outward
 * @returns {Triangle[]}
 */
function quad(a, b, c, d, outward) {
  return dot(cross(minus(b, a), minus(c, a)), outward) >= 0
    ? [[a, b, c], [a, c, d]]
    : [[a, c, b], [a, d, c]]
}

/**
 * A box between two corners: 12 triangles, facing out.
 * @param {Vec3} min
 * @param {Vec3} max
 * @returns {Triangle[]}
 */
export function box(min, max) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  /** @type {(x: number, y: number, z: number) => Vec3} */
  const p = (x, y, z) => [x, y, z]
  return [
    ...quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), [1, 0, 0]),
    ...quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), [-1, 0, 0]),
    ...quad(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), [0, 1, 0]),
    ...quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), [0, -1, 0]),
    ...quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), [0, 0, 1]),
    ...quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), [0, 0, -1]),
  ]
}

/**
 * A closed cylinder standing on `base` along `axis`: 4 triangles per segment, facing out.
 * @param {{ radius: number, height: number, base?: Vec3, axis?: 'y' | 'z', segments?: number }} options
 * @returns {Triangle[]}
 */
export function cylinder({ radius, height, base = [0, 0, 0], axis = 'y', segments = 24 }) {
  // built with y along the axis, then put in place: with axis z, y becomes z and z becomes -y
  /** @type {(u: number, h: number, w: number) => Vec3} */
  const p = (u, h, w) => (axis === 'y' ? [base[0] + u, base[1] + h, base[2] + w] : [base[0] + u, base[1] - w, base[2] + h])
  const up = p(0, 1, 0)
  const along = minus(up, base)
  /** @type {Triangle[]} */
  const out = []
  for (let k = 0; k < segments; k++) {
    const a = (2 * Math.PI * k) / segments
    const b = (2 * Math.PI * (k + 1)) / segments
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]
    const mid = (a + b) / 2
    const radial = minus(p(Math.cos(mid), 0, Math.sin(mid)), base)
    out.push(...quad(p(radius * ca, 0, radius * sa), p(radius * cb, 0, radius * sb), p(radius * cb, height, radius * sb), p(radius * ca, height, radius * sa), radial))
    /** @type {Triangle} */
    const top = [p(0, height, 0), p(radius * ca, height, radius * sa), p(radius * cb, height, radius * sb)]
    /** @type {Triangle} */
    const bottom = [p(0, 0, 0), p(radius * ca, 0, radius * sa), p(radius * cb, 0, radius * sb)]
    out.push(dot(faceNormal(top), along) >= 0 ? top : [top[0], top[2], top[1]])
    out.push(dot(faceNormal(bottom), along) <= 0 ? bottom : [bottom[0], bottom[2], bottom[1]])
  }
  return out
}

/** @param {string} text */
const ascii = (text) => new TextEncoder().encode(text)
/**
 * The bytes in an ArrayBuffer of their own, exactly as long as they are.
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
const exact = (bytes) => {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out.buffer
}

/** the corners of a unit cube standing on the origin: x and z from -0.5 to 0.5, y from 0 to 1 */
export const UNIT_CUBE = box([-0.5, 0, -0.5], [0.5, 1, 0.5])

/**
 * A binary STL: an 80-byte header, the triangle count, then 50 bytes per
 * triangle. The header doesn't start with 'solid' unless asked to, as a
 * binary STL's must not (STLLoader would read it as text when the count is off).
 * @param {Triangle[]} [triangles]
 * @param {{ header?: string, count?: number }} [options] `count`: the count to write, when it should be wrong
 * @returns {ArrayBuffer}
 */
export function binaryStl(triangles = UNIT_CUBE, { header = 'binary STL made by lysark tests', count = triangles.length } = {}) {
  const buffer = new ArrayBuffer(84 + 50 * triangles.length)
  const bytes = new Uint8Array(buffer)
  bytes.set(ascii(header).slice(0, 80))
  const view = new DataView(buffer)
  view.setUint32(80, count, true)
  triangles.forEach((triangle, t) => {
    let at = 84 + 50 * t
    for (const v of [faceNormal(triangle), ...triangle]) {
      for (const x of v) {
        view.setFloat32(at, x, true)
        at += 4
      }
    }
    // the attribute byte count, which some programs use for a colour, left 0
  })
  return buffer
}

/**
 * A text STL, as CAD programs write it.
 * @param {Triangle[]} [triangles]
 * @param {string} [name]
 * @returns {ArrayBuffer}
 */
export function textStl(triangles = UNIT_CUBE, name = 'part') {
  /** @param {Vec3} v */
  const numbers = (v) => v.map((x) => x.toExponential(6)).join(' ')
  const lines = [`solid ${name}`]
  for (const triangle of triangles) {
    lines.push(`  facet normal ${numbers(faceNormal(triangle))}`, '    outer loop')
    for (const v of triangle) lines.push(`      vertex ${numbers(v)}`)
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`, '')
  return exact(ascii(lines.join('\n')))
}

/**
 * One mesh of a GLB, on a node of its own.
 * @typedef {object} GlbMesh
 * @property {string} [name]
 * @property {Triangle[]} [triangles] its triangles (a unit cube without): the corners in order, not indexed
 * @property {boolean} [normals] false: no NORMAL attribute, as some exporters write
 * @property {number} [mode] the primitive's mode: 4 triangles (without), 1 lines, 0 points
 * @property {Vec3} [translation] the node's
 * @property {[number, number, number, number]} [rotation] the node's, a quaternion [x, y, z, w]
 * @property {Vec3} [scale] the node's
 */

/** @typedef {Record<string, any>} GlbJson */
/** @typedef {(json: GlbJson) => void} GlbEdit a change to a GLB's JSON before it is written */

/**
 * A binary glTF 2.0 file (.glb): a JSON chunk, then one binary chunk with
 * every mesh's positions (and normals), and no materials. `root`: a node
 * all the meshes hang on, with its own transform. `edits` change the JSON
 * before it is written (see glbEdits). With no meshes, there is no binary
 * chunk and no buffer: a well-formed file with nothing to show.
 * @param {{ meshes?: GlbMesh[], root?: { translation?: Vec3, rotation?: [number, number, number, number], scale?: Vec3 }, edits?: GlbEdit[] }} [options]
 * @returns {ArrayBuffer}
 */
export function glb({ meshes = [{}], root, edits = [] } = {}) {
  /** @type {number[]} */
  const floats = []
  /** @type {GlbJson} */
  const json = {
    asset: { version: '2.0', generator: 'lysark tests' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    buffers: [],
    bufferViews: [],
    accessors: [],
  }
  /** @param {number[]} values flattened VEC3s */
  const accessor = (values) => {
    const count = values.length / 3
    /** @type {Vec3} */
    const min = [Infinity, Infinity, Infinity]
    /** @type {Vec3} */
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < values.length; i++) {
      min[i % 3] = Math.min(min[i % 3], values[i])
      max[i % 3] = Math.max(max[i % 3], values[i])
    }
    json.bufferViews.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: values.length * 4, target: 34962 })
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count, type: 'VEC3', min, max })
    // one at a time: spreading a large model's numbers into push() would overflow the stack
    for (const value of values) floats.push(value)
    return json.accessors.length - 1
  }
  /** @type {number[]} */
  const meshNodes = []
  meshes.forEach(({ name, triangles = UNIT_CUBE, normals = true, mode, translation, rotation, scale }, k) => {
    /** @type {Record<string, number>} */
    const attributes = { POSITION: accessor(triangles.flat(2)) }
    if (normals) attributes.NORMAL = accessor(triangles.flatMap((t) => [faceNormal(t), faceNormal(t), faceNormal(t)]).flat())
    json.meshes.push({ name: name ?? `mesh${k}`, primitives: [{ attributes, ...(mode === undefined ? {} : { mode }) }] })
    json.nodes.push({
      name: name ?? `mesh${k}`,
      mesh: k,
      ...(translation ? { translation } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
    })
    meshNodes.push(json.nodes.length - 1)
  })
  if (root) {
    json.nodes.push({ name: 'root', children: meshNodes, ...root })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  } else {
    json.scenes[0].nodes.push(...meshNodes)
  }
  const binary = new Uint8Array(new Float32Array(floats).buffer)
  // with no meshes, a file with no data at all: glTF allows no empty buffer
  if (binary.length > 0) json.buffers.push({ byteLength: binary.length })
  for (const edit of edits) edit(json)

  // chunks are padded to 4 bytes: the JSON with spaces, the binary with zeros
  const text = ascii(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const binLength = Math.ceil(binary.length / 4) * 4
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0))
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  bytes.fill(0x20, 20, 20 + jsonLength)
  bytes.set(text, 20)
  if (binLength > 0) {
    view.setUint32(20 + jsonLength, binLength, true)
    view.setUint32(24 + jsonLength, 0x004e4942, true) // 'BIN'
    bytes.set(binary, 28 + jsonLength)
  }
  return buffer
}

/** @param {GlbJson} json @param {string} name @param {boolean} required */
function useExtension(json, name, required) {
  json.extensionsUsed = [...(json.extensionsUsed ?? []), name]
  if (required) json.extensionsRequired = [...(json.extensionsRequired ?? []), name]
}

/**
 * Changes to a GLB's JSON, for glb({ edits }), each one thing the checks
 * refuse or the loader leaves out. Lines and points are meshes of their own:
 * glb({ meshes: [{}, { mode: 1 }] }).
 */
export const glbEdits = {
  /**
   * An embedded image used as a texture.
   * @returns {GlbEdit}
   */
  image: () => (json) => {
    json.images = [{ uri: 'texture.png' }]
    json.textures = [{ source: 0 }]
  },
  /**
   * The binary data at a data: address, not in the file's own chunk.
   * @returns {GlbEdit}
   */
  bufferUri: () => (json) => {
    json.buffers[0].uri = 'data:application/octet-stream;base64,AAAA'
  },
  /**
   * A second buffer, in another file.
   * @returns {GlbEdit}
   */
  twoBuffers: () => (json) => {
    json.buffers.push({ byteLength: 4, uri: 'more.bin' })
  },
  /**
   * An extension in extensionsUsed, and in extensionsRequired too unless `required` is false.
   * @param {string} name
   * @param {boolean} [required]
   * @returns {GlbEdit}
   */
  extension: (name, required = true) => (json) => useExtension(json, name, required),
  /**
   * A skin: bones.
   * @returns {GlbEdit}
   */
  skin: () => (json) => {
    json.skins = [{ joints: [0] }]
  },
  /**
   * The first mesh marked skinned in the JSON itself, with weights read from
   * its positions and no skin: isSkinnedMesh isn't glTF, but GLTFLoader reads
   * it and makes a SkinnedMesh, with no skeleton.
   * @returns {GlbEdit}
   */
  skinnedMesh: () => (json) => {
    const positions = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
    json.accessors.push({ bufferView: positions.bufferView, componentType: 5126, count: Math.floor((positions.count * 3) / 4), type: 'VEC4' })
    json.meshes[0].primitives[0].attributes.WEIGHTS_0 = json.accessors.length - 1
    json.meshes[0].isSkinnedMesh = true
  },
  /**
   * GPU instancing on the first node, without extensionsUsed listing it: an
   * instance at each of the first mesh's corners.
   * @returns {GlbEdit}
   */
  instancedNode: () => (json) => {
    const node = json.nodes[0]
    node.extensions = { ...(node.extensions ?? {}), EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: json.meshes[0].primitives[0].attributes.POSITION } } }
  },
  /**
   * A point light (KHR_lights_punctual) on a node of its own.
   * @returns {GlbEdit}
   */
  light: () => (json) => {
    useExtension(json, 'KHR_lights_punctual', false)
    json.extensions = { ...(json.extensions ?? {}), KHR_lights_punctual: { lights: [{ type: 'point', color: [1, 1, 1], intensity: 10 }] } }
    json.nodes.push({ name: 'light', translation: [0, 2, 0], extensions: { KHR_lights_punctual: { light: 0 } } })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  },
  /**
   * A camera on a node of its own.
   * @returns {GlbEdit}
   */
  camera: () => (json) => {
    json.cameras = [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.01 } }]
    json.nodes.push({ name: 'camera', translation: [0, 0, 3], camera: 0 })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  },
  /**
   * The asset's glTF version, '2.0' without.
   * @param {string} version
   * @returns {GlbEdit}
   */
  version: (version) => (json) => {
    json.asset.version = version
  },
}

/**
 * A GLB chunk: its length, its type, then its content, padded to 4 bytes
 * (the JSON with spaces, the binary with zeros). For withGlbTail.
 * @param {'JSON' | 'BIN'} type
 * @param {GlbJson | Uint8Array} content the JSON, or the binary's bytes
 * @param {{ length?: number }} [options] `length`: the length to write, when it should be wrong
 * @returns {Uint8Array}
 */
export function glbChunk(type, content, { length } = {}) {
  const data = content instanceof Uint8Array ? content : ascii(JSON.stringify(content))
  const padded = Math.ceil(data.length / 4) * 4
  const bytes = new Uint8Array(8 + padded).fill(type === 'JSON' ? 0x20 : 0, 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, length ?? padded, true)
  view.setUint32(4, type === 'JSON' ? 0x4e4f534a : 0x004e4942, true)
  bytes.set(data, 8)
  return bytes
}

/**
 * The GLB with `tail` after its last chunk, and its header's length to
 * match: a chunk from glbChunk, or the start of one.
 * @param {ArrayBuffer} file a GLB
 * @param {Uint8Array} tail
 * @returns {ArrayBuffer}
 */
export function withGlbTail(file, tail) {
  const out = new Uint8Array(file.byteLength + tail.length)
  out.set(new Uint8Array(file))
  out.set(tail, file.byteLength)
  new DataView(out.buffer).setUint32(8, out.length, true)
  return out.buffer
}

/**
 * What a Git LFS pointer file holds in place of a model: a few lines of text.
 * @returns {ArrayBuffer}
 */
export function lfsPointer() {
  return exact(
    ascii(
      'version https://git-lfs.github.com/spec/v1\n' +
        'oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n' +
        'size 1912334\n',
    ),
  )
}

/**
 * The file with one byte more at the end: a length that matches neither a
 * binary STL's triangle count nor a GLB's header.
 * @param {ArrayBuffer} file
 * @returns {ArrayBuffer}
 */
export function withExtraByte(file) {
  const out = new Uint8Array(file.byteLength + 1)
  out.set(new Uint8Array(file))
  return out.buffer
}
