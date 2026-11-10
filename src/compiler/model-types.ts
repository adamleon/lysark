import { MAX_METRES, type ModelUnit } from '../engine/object-types'

/**
 * The model files a scene file can name (docs/scene-files.md, "Models"), and
 * the checks the compiler, the build (vite-plugin-slides.ts) and the editor
 * panel share, so all three say the same thing. Pure, without three.js: the
 * checks that need a parse are in src/scene/model-check.ts.
 *
 * Everything refused here would need a network request, a worker or wasm, or
 * GPU memory that src/scene/dispose.ts doesn't free, so a model that passes
 * keeps the student file working from file:// (lysark-design.md §9) and one
 * scene's GPU resources alive at a time (§4.1).
 */

/** the model files, by extension (any case): STL, binary or text, and binary glTF */
export const MODEL_FORMATS = { '.stl': 'stl', '.glb': 'glb' } as const
export type ModelFormat = (typeof MODEL_FORMATS)[keyof typeof MODEL_FORMATS]

/** the format of the model file at `path`, by its extension (any case); undefined if not a model */
export function modelFormat(path: string): ModelFormat | undefined {
  const dot = path.lastIndexOf('.')
  if (dot <= path.lastIndexOf('/')) return undefined
  const extension = path.slice(dot).toLowerCase()
  return Object.hasOwn(MODEL_FORMATS, extension) ? MODEL_FORMATS[extension as keyof typeof MODEL_FORMATS] : undefined
}

/** metres per unit of what a file is measured in (`unit:`, m without it) */
export const MODEL_UNITS: Record<ModelUnit, number> = { mm: 0.001, cm: 0.01, m: 1 }

/**
 * At most this many bytes per model file on disk. About 100k triangles as
 * binary STL, and far under the editor host's own 32 MB per file, so the
 * lecturer sees this advice rather than the host's.
 */
export const MODEL_MAX_BYTES = 5_000_000

/** a model must be at least this large (its largest side, metres): anything smaller is metres read as millimetres */
export const MIN_MODEL_METRES = 0.001

/** a model a lecture uses, as a scene file writes it; the compiler reports them, and the build and the panel read them */
export interface ModelRef {
  /** the path as written, from the lecture folder (where slides.md is) */
  src: string
  format: ModelFormat
  /** what the file is measured in, for the extent check */
  unit: ModelUnit
  /** the object that shows it */
  object: string
  /** the scene file it is written in, `scenes/arm.yaml` */
  file: string
  /** the line of its `model:` value */
  line: number
}

/** where a model is written, as a compile error names it: `scenes/arm.yaml, line 12: object 'bracket'` */
export function modelWhere(ref: Pick<ModelRef, 'file' | 'line' | 'object'>): string {
  return `${ref.file}, line ${ref.line}: object '${ref.object}'`
}

/**
 * What is wrong with a model's path as written, or null. Only the text is
 * checked, so the compiler can say it with the scene file's line: where the
 * file is, and whether it is there, is for the build and the panel. As for
 * images, the path is from the lecture folder; unlike them it is taken
 * literally, without percent-decoding.
 */
export function modelPathProblem(src: string): string | null {
  // a drive letter, or a Windows share: never a web address
  if (/^[a-z]:|^\\\\/i.test(src)) {
    return (
      `model '${src}' is an absolute path on this computer: copy the file into the lecture folder (for example models/) ` +
      `or the course's assets/ folder, and give the path from the lecture folder`
    )
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
    return (
      `model '${src}' is a web address. The lecture file must work offline: save the file into the lecture folder ` +
      `or the course's assets/ folder and give its path`
    )
  }
  if (src.includes('\\')) return `model '${src}' contains a backslash: use /, such as ${src.replace(/\\/g, '/')}`
  if (src.startsWith('/')) return `model '${src}' starts with '/': give the path from the lecture folder, such as models/bracket.stl`
  // the build would read these, but the released editor host (extension 0.3.0,
  // resolveInside in extension/src/logic.ts) won't: a hidden name, a Windows
  // short name (`ENV~1` for `.env`), and a ':' anywhere. Refused here, so the
  // build and the panel say the same, at the scene file's line
  const segments = src.split('/')
  for (const [k, segment] of segments.entries()) {
    if (segment === '' || segment === '.' || segment === '..') continue
    const kind = k === segments.length - 1 ? 'file' : 'folder'
    const panel = `which VS Code's panel won't read: rename the ${kind}`
    if (segment.startsWith('.')) return `model '${src}' has a ${kind} name starting with '.' ('${segment}'), ${panel}`
    if (/~\d/.test(segment)) return `model '${src}' has a ${kind} name with ~ and a digit ('${segment}'), like a Windows short name, ${panel}`
    if (segment.includes(':')) return `model '${src}' has a ${kind} name with a colon ('${segment}'), ${panel}`
  }
  const dot = src.lastIndexOf('.')
  if (dot > src.lastIndexOf('/') && src.slice(dot).toLowerCase() === '.gltf') {
    return `model '${src}' is glTF as text, which keeps its data in other files: export it as binary glTF (.glb)`
  }
  if (!modelFormat(src)) return `model '${src}' isn't a file a lecture can show: export it from the CAD program as .stl (binary) or .glb`
  return null
}

/** a byte count in MB, with as many decimals as it takes to show it is over the limit */
function megabytes(bytes: number): string {
  const limit = MODEL_MAX_BYTES / 1e6
  for (let decimals = 1; decimals < 6; decimals++) {
    const shown = (bytes / 1e6).toFixed(decimals)
    if (Number(shown) > limit) return shown
  }
  return (bytes / 1e6).toFixed(6)
}

/**
 * What to do about a model file over the limit; the editor panel also gives
 * it when VS Code won't read a file that large at all (panel-models.ts).
 */
export const MODEL_SIZE_ADVICE =
  `a model may be at most ${MODEL_MAX_BYTES / 1e6} MB. ` +
  `Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)`

/**
 * What is wrong with a model file of `bytes` bytes, or null. The build
 * asks before reading the file, and the panel from the length of the base64
 * the host sends, before decoding it.
 */
export function modelSizeProblem(bytes: number): string | null {
  if (bytes <= MODEL_MAX_BYTES) return null
  return `the model is ${megabytes(bytes)} MB; ${MODEL_SIZE_ADVICE}`
}

/**
 * What a GLB with bones or GPU instancing gets: a skin's bone texture and
 * instancing's buffers outlive the scene, as dispose.ts frees neither. Told
 * from the JSON here, and from what the loader built in model-check.ts.
 */
export const MODEL_BONES_PROBLEM = `the model has bones (a skin), which a lecture can't show: apply the armature, or export without it`
export const MODEL_INSTANCING_PROBLEM = `the model uses GPU instancing: export it without GPU instances`

const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1'
const GLB_MAGIC = 0x46546c67 // 'glTF', little-endian
const GLB_JSON_CHUNK = 0x4e4f534a // 'JSON'
/** the members of a glTF's JSON that GLTFLoader indexes as lists (GLTFParser) */
const GLTF_LISTS = [
  'accessors',
  'animations',
  'buffers',
  'bufferViews',
  'cameras',
  'extensionsRequired',
  'extensionsUsed',
  'images',
  'materials',
  'meshes',
  'nodes',
  'samplers',
  'scenes',
  'skins',
  'textures',
]
/** these keep images: textured models wait for step 9 (scene-files-proposal.md), as dispose.ts frees no textures */
const TEXTURE_EXTENSIONS = ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']
/** these unpack in a worker or with wasm, which the student file can't use offline */
const COMPRESSION_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression']

/** a required glTF extension the model can still be shown without: GLTFLoader reads it, or the preset colour replaces what it changes */
function readableExtension(name: string): boolean {
  return name === 'KHR_mesh_quantization' || name.startsWith('KHR_materials_') || name === 'KHR_texture_transform' || name === 'KHR_lights_punctual'
}

/** true when the bytes start with `text` (ASCII) at `offset` */
function startsWith(bytes: Uint8Array, text: string, offset = 0): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false
  return true
}

/**
 * What is wrong with a model file's bytes, or null: what can be told
 * without parsing it. For a GLB this reads the JSON chunk, so a file that
 * would need a request, a worker, wasm or GPU memory dispose.ts doesn't
 * free is refused before GLTFLoader ever sees it.
 */
export function modelBytesProblem(buffer: ArrayBuffer, format: ModelFormat): string | null {
  const size = modelSizeProblem(buffer.byteLength)
  if (size) return size
  const bytes = new Uint8Array(buffer)
  if (startsWith(bytes, LFS_POINTER)) {
    return (
      `the model is a Git LFS pointer, not the model: the course build doesn't fetch LFS files. ` +
      `Keep the file in git itself (git lfs untrack, then commit it again)`
    )
  }
  const view = new DataView(buffer)
  if (format === 'stl') {
    // as STLLoader decides: binary when the length fits the triangle count in the
    // header, text when 'solid' starts within the first 5 bytes (after a byte order mark)
    const binary = buffer.byteLength >= 84 && 84 + 50 * view.getUint32(80, true) === buffer.byteLength
    const text = [0, 1, 2, 3, 4].some((offset) => startsWith(bytes, 'solid', offset))
    if (!binary && !text) {
      return `the model isn't an STL file: a binary STL is 84 bytes plus 50 per triangle, and a text STL starts with 'solid'. Export it again`
    }
    return null
  }

  const notGlb = `the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)`
  // the 12-byte header, then the chunks, each its length, its type and its
  // bytes, up to the length the header gives. GLTFLoader reads them all and
  // keeps the last JSON chunk, so the JSON read here must be the only one: the first chunk
  if (buffer.byteLength < 20) return notGlb
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) return notGlb
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK) return notGlb
  for (let at = 12; at < buffer.byteLength; ) {
    if (at + 8 > buffer.byteLength) return notGlb
    const length = view.getUint32(at, true)
    if (at + 8 + length > buffer.byteLength) return notGlb
    if (at > 12 && view.getUint32(at + 4, true) === GLB_JSON_CHUNK) return notGlb
    at += 8 + length
  }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)))
  } catch {
    return notGlb
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return notGlb
  const asset = json.asset as { version?: unknown } | undefined
  // GLTFLoader refuses glTF 1.0 itself, with a message that would need explaining
  if (typeof asset?.version !== 'string' || !asset.version.startsWith('2.')) return notGlb
  // GLTFLoader indexes these whatever they are, so one written as an object
  // would be read without the checks below seeing it
  if (GLTF_LISTS.some((name) => Object.hasOwn(json, name) && !Array.isArray(json[name]))) return notGlb

  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  const required = list(json.extensionsRequired)
  const used = new Set([...list(json.extensionsUsed), ...required])
  if (list(json.images).length > 0 || list(json.textures).length > 0 || TEXTURE_EXTENSIONS.some((name) => used.has(name))) {
    return (
      `the model has textures, which come in a later step. Its colour comes from material: anyway, ` +
      `so export it without materials or textures (or as STL)`
    )
  }
  // GLTFLoader fetches any buffer but the GLB's own: blocked offline and in the editor panel
  const buffers = list(json.buffers)
  if (buffers.length > 1 || (buffers.length === 1 && (buffers[0] as { uri?: unknown } | null)?.uri !== undefined)) {
    return `the model keeps data outside the .glb (in another file or a data: address): export it as one self-contained .glb`
  }
  // so a buffer view's buffer must be 0, the GLB's own: GLTFLoader fetches the
  // file of any other, even '0' (a string), whose address it takes as ''
  const bufferViews = list(json.bufferViews) as Array<{ buffer?: unknown; extensions?: Record<string, unknown> } | null>
  if (bufferViews.some((bufferView) => bufferView?.buffer !== 0)) return notGlb
  // GLTFLoader reads a meshopt buffer view as one whatever extensionsUsed lists,
  // and asks for the buffer its extension names before it looks for a decoder
  const compression = COMPRESSION_EXTENSIONS.find(
    (name) => used.has(name) || bufferViews.some((bufferView) => bufferView?.extensions?.[name] !== undefined),
  )
  if (compression) return `the model is compressed (${compression}), which the lecture file can't unpack offline: export it without compression`
  // as GLTFLoader decides: a node with a skin is a skinned mesh, and one with
  // the instancing extension is instanced, whatever extensionsUsed lists
  const nodes = list(json.nodes) as Array<{ skin?: unknown; extensions?: Record<string, unknown> } | null>
  if (list(json.skins).length > 0 || nodes.some((node) => node?.skin !== undefined)) return MODEL_BONES_PROBLEM
  const instanced = nodes.some((node) => node?.extensions?.EXT_mesh_gpu_instancing !== undefined)
  if (used.has('EXT_mesh_gpu_instancing') || instanced) return MODEL_INSTANCING_PROBLEM
  // GLTFLoader only warns about a required extension it doesn't know, and shows the model wrong
  const unread = required.find((name) => typeof name !== 'string' || !readableExtension(name))
  if (unread !== undefined) return `the model needs the glTF extension '${String(unread)}', which lysark doesn't read: export it without it`
  return null
}

/** a length to three significant digits, without trailing zeros */
function rounded(value: number): string {
  return String(Number(value.toPrecision(3)))
}

/**
 * What is wrong with a model's size, or null: `maxSide` is the
 * largest side of its bounding box in the file's own units, read in `unit`.
 * Larger than MAX_METRES or smaller than a millimetre is a file read in the
 * wrong unit, and the message says which to write.
 */
export function modelExtentProblem(maxSide: number, unit: ModelUnit): string | null {
  const metres = maxSide * MODEL_UNITS[unit]
  if (!Number.isFinite(metres)) return `the model's points aren't all numbers: export it again`
  if (metres > MAX_METRES) {
    return unit === 'm'
      ? `the model is ${rounded(metres)} m across, read in m. Is the file in millimetres? Write unit: mm`
      : `the model is ${rounded(metres)} m across even read in ${unit}: check unit`
  }
  if (metres < MIN_MODEL_METRES) {
    return unit === 'm'
      ? `the model is ${rounded(metres * 1000)} mm across, read in m: a model is at least 1 mm across. Export it again at its real size`
      : `the model is ${rounded(metres * 1000)} mm across, read in ${unit}. Is the file in metres? Leave out unit`
  }
  return null
}
