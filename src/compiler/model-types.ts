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
 * scene's GPU resources alive at a time (§4.1). With material: file, so would
 * a texture that isn't a PNG or JPEG inside the file, or is larger than 2048
 * pixels on a side; and a material the stage would draw black or not at all
 * is refused too (decision 10 in scene-files-proposal.md).
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

/**
 * Where a model's look comes from, as its object's `material:` line says
 * (decision 10 in scene-files-proposal.md): `file`, the file's own materials
 * and textures (`material: file`, a GLB only); `preset`, a colour written,
 * which replaces the file's; `default`, no `material:` line, which gives the
 * grey preset, but stops the build for a file with textures, so the lecturer
 * chooses between the two.
 */
export type ModelLook = 'file' | 'preset' | 'default'

/** a model a lecture uses, as a scene file writes it; the compiler reports them, and the build and the panel read them */
export interface ModelRef {
  /** the path as written, from the lecture folder (where slides.md is) */
  src: string
  format: ModelFormat
  /** what the file is measured in, for the extent check */
  unit: ModelUnit
  /** where its look comes from, for the checks of its textures and materials */
  look: ModelLook
  /** the object that shows it */
  object: string
  /** the scene file it is written in, `scenes/arm.yaml` */
  file: string
  /** the line of its `model:` value */
  line: number
}

/** a texture's image may be at most this many pixels on a side: as RGBA with mipmaps, about 22 MB of GPU memory */
export const MAX_TEXTURE_PIXELS = 2048

/**
 * With material: file, a material without a metallic texture may be at most
 * this metallic. The stage has no reflections for a metal to show (no
 * environment map), so a metal shows only the key light's highlight and is
 * near black elsewhere. 0.6 is the `metal` preset's (src/scene/objects.ts).
 */
export const MAX_FILE_METALNESS = 0.6

/** where a model is written, as a compile error names it: `scenes/arm.yaml, line 12: object 'bracket'` */
export function modelWhere(ref: Pick<ModelRef, 'file' | 'line' | 'object'>): string {
  return `${ref.file}, line ${ref.line}: object '${ref.object}'`
}

/**
 * A model object, by its scene file and name, as the panel names one it
 * leaves without its model while showing the file to other objects
 * (panel-models.ts, deck-from-source.ts): `scenes/arm.yaml marker`. A scene
 * file's path has no spaces, so the two can't run together.
 */
export function modelObjectKey(ref: Pick<ModelRef, 'file' | 'object'>): string {
  return `${ref.file} ${ref.object}`
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
 * it when VS Code won't read a file that large at all (panel-models.ts). A
 * GLB's textures count in it: a 2048-pixel photo is 5 MB or more as PNG, and
 * well under 1 MB as JPEG.
 */
export function modelSizeAdvice(format: ModelFormat): string {
  const limit = `a model may be at most ${MODEL_MAX_BYTES / 1e6} MB`
  return format === 'glb'
    ? `${limit}, its textures included. Export it with fewer triangles, or its textures as JPEG rather than PNG ` +
        `(in Blender's glTF export, under Data > Material, Images: JPEG Format) or smaller`
    : `${limit}. Export it with fewer triangles, or as binary STL rather than text STL (about five times smaller)`
}

/**
 * What is wrong with a model file of `bytes` bytes, or null. The build
 * asks before reading the file, and the panel from the length of the base64
 * the host sends, before decoding it.
 */
export function modelSizeProblem(bytes: number, format: ModelFormat): string | null {
  if (bytes <= MODEL_MAX_BYTES) return null
  return `the model is ${megabytes(bytes)} MB; ${modelSizeAdvice(format)}`
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
const GLB_BIN_CHUNK = 0x004e4942 // 'BIN'
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
/**
 * these keep a texture's image as something other than PNG or JPEG, by the
 * name a message gives it: KTX2 needs a decoder in a worker, which the student
 * file can't use offline, and a lecture shows PNG and JPEG only
 */
const TEXTURE_EXTENSIONS: Record<string, string> = { KHR_texture_basisu: 'KTX2', EXT_texture_webp: 'WebP', EXT_texture_avif: 'AVIF' }
/**
 * the images a texture can be, by glTF's mimeType, and the name a message
 * gives each. glTF says image/jpeg; some programs write image/jpg, which
 * three.js shows as well (the bytes are checked to be a JPEG either way)
 */
const TEXTURE_IMAGES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/jpg': 'JPEG' }
/** in Blender's glTF export, where its textures are made PNG or JPEG */
const BLENDER_IMAGES = `in Blender's glTF export, under Data > Material, Images: JPEG Format, with Create WebP off`
/** these unpack in a worker or with wasm, which the student file can't use offline */
const COMPRESSION_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression']
/**
 * these make a material see-through: three draws transmission with a second
 * pass over the scene into a render target the renderer keeps, and the others
 * build on transmission or aren't read
 */
const SEE_THROUGH_EXTENSIONS = ['KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_dispersion', 'KHR_materials_diffuse_transmission']
/** the material extensions GLTFLoader reads, but for the see-through ones: with material: file, a model that needs another is shown wrong */
const FILE_MATERIAL_EXTENSIONS = [
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_unlit',
  'EXT_materials_bump',
]

/**
 * A required glTF extension the model can still be shown without: GLTFLoader
 * reads it, or, with a preset, the preset replaces what it changes (the
 * file's materials and textures are left out). With material: file, only
 * what GLTFLoader reads; a see-through material is refused on its own.
 */
function readableExtension(name: string, look: ModelLook): boolean {
  if (name === 'KHR_mesh_quantization' || name === 'KHR_texture_transform' || name === 'KHR_lights_punctual') return true
  if (look === 'file') return FILE_MATERIAL_EXTENSIONS.includes(name) || SEE_THROUGH_EXTENSIONS.includes(name)
  return name.startsWith('KHR_materials_') || name.startsWith('EXT_materials_') || (look === 'preset' && Object.hasOwn(TEXTURE_EXTENSIONS, name))
}

/** true when the bytes start with `text` (ASCII) at `offset` */
function startsWith(bytes: Uint8Array, text: string, offset = 0): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false
  return true
}

/** what a GLB with textures and no material: line gets: the lecturer chooses how it looks */
export const MODEL_TEXTURES_UNCHOSEN =
  `the model has textures: write material: file to show them, with the file's own colours, ` +
  `or a colour such as material: grey to colour it all with that`

/**
 * What to do about a see-through material, with material: file. Blender's
 * glTF export writes a material as blended whenever anything is linked to
 * the Principled BSDF's Alpha, or it is under 1 (Blender 4.2 and later have
 * no blend mode of their own); model-check.ts says it too.
 */
export const MODEL_OPAQUE_ADVICE =
  `make it opaque in the program that made it (in Blender, the Principled BSDF's Alpha at 1, with nothing linked to it), ` +
  `or write a colour such as material: grey`

/**
 * What a GLB whose textures are kept as KTX2, WebP or AVIF gets, or null:
 * a lecture shows PNG and JPEG only. GLTFLoader reads a texture's extension
 * whatever extensionsUsed lists, so a texture's own counts too.
 */
function unshownTextures(json: Record<string, unknown>, used: Set<unknown>): string | null {
  const textures = Array.isArray(json.textures) ? json.textures : []
  const other = Object.keys(TEXTURE_EXTENSIONS).find(
    (name) => used.has(name) || textures.some((texture) => asJson(asJson(texture)?.extensions)?.[name] !== undefined),
  )
  if (!other) return null
  return `the model's textures are ${TEXTURE_EXTENSIONS[other]} (${other}), which a lecture can't show: export the textures as PNG or JPEG (${BLENDER_IMAGES})`
}

/**
 * What is wrong with a model file's bytes, or null: what can be told
 * without parsing it. For a GLB this reads the JSON chunk, so a file that
 * would need a request, a worker, wasm or GPU memory dispose.ts doesn't
 * free is refused before GLTFLoader ever sees it. `look` is where the
 * model's look comes from: with `file`, its textures' images (their type and
 * size, read from their headers) and its materials are checked too.
 */
export function modelBytesProblem(buffer: ArrayBuffer, format: ModelFormat, look: ModelLook = 'default'): string | null {
  const size = modelSizeProblem(buffer.byteLength, format)
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
  // the binary chunk: GLTFLoader keeps the last, and reads the images from it
  let binary: Uint8Array | undefined
  for (let at = 12; at < buffer.byteLength; ) {
    if (at + 8 > buffer.byteLength) return notGlb
    const length = view.getUint32(at, true)
    if (at + 8 + length > buffer.byteLength) return notGlb
    if (at > 12 && view.getUint32(at + 4, true) === GLB_JSON_CHUNK) return notGlb
    if (view.getUint32(at + 4, true) === GLB_BIN_CHUNK) binary = new Uint8Array(buffer, at + 8, length)
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
  const textured = list(json.images).length > 0 || list(json.textures).length > 0 || Object.keys(TEXTURE_EXTENSIONS).some((name) => used.has(name))
  if (textured && look === 'default') {
    // textures material: file can't show either: said now, not after the lecturer writes it
    const other = unshownTextures(json, used)
    return other
      ? `${other}, and write material: file to show them, or a colour such as material: grey to colour it all with that`
      : MODEL_TEXTURES_UNCHOSEN
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
  if (look === 'file') {
    const own = ownLookProblem(json, used, binary)
    if (own) return own
  }
  // GLTFLoader only warns about a required extension it doesn't know, and shows the model wrong
  const unread = required.find((name) => typeof name !== 'string' || !readableExtension(name, look))
  if (unread !== undefined) return `the model needs the glTF extension '${String(unread)}', which lysark doesn't read: export it without it`
  return null
}

type Json = Record<string, unknown>
const asJson = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined)
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const isIndex = (value: unknown, length: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < length

/** a glTF item as a message names it: by its name, or by its place in the file, counted from 1 */
function itemName(item: unknown, k: number): string {
  const name = asJson(item)?.name
  return typeof name === 'string' && name.trim() !== '' ? `'${name}'` : `number ${k + 1}`
}

/** calls `found` with each texture a material uses (a key ending in Texture, as every glTF material texture's does, its extensions' included) */
function materialTextures(value: unknown, found: (texture: Json) => void): void {
  for (const [key, inner] of Object.entries(asJson(value) ?? {})) {
    if (key === 'extras') continue
    const texture = asJson(inner)
    if (key.endsWith('Texture') && texture) found(texture)
    else if (typeof inner === 'object' && inner !== null) materialTextures(inner, found)
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** a PNG's size in pixels, from its header (IHDR), without decoding it; undefined if it isn't a PNG */
export function pngSize(data: Uint8Array): { width: number; height: number } | undefined {
  if (data.length < 24 || PNG_SIGNATURE.some((byte, k) => data[k] !== byte) || !startsWith(data, 'IHDR', 12)) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/**
 * A JPEG's size in pixels, from its frame header (SOF0 to SOF15), without
 * decoding it; undefined if it isn't a JPEG, has no frame header before its
 * image data, or has a marker libjpeg reads otherwise or refuses.
 */
export function jpegSize(data: Uint8Array): { width: number; height: number } | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined
  let at = 2
  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return undefined
    const marker = data[at + 1]
    // a fill byte before a marker, and the markers without a length
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    // the start of another image, its end, or its data: no frame header came first
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return undefined
    // as libjpeg, the browsers' JPEG decoder, reads them. FF 00 isn't a marker:
    // libjpeg skips it and every byte up to the next FF, so a length read after
    // it could skip a frame header that libjpeg reads, and a larger image would
    // pass. And libjpeg refuses the reserved markers (0x02 to 0xbf, 0xc8, 0xde,
    // 0xdf, 0xf0 to 0xfd), so the image wouldn't show
    if (marker <= 0xbf || marker === 0xc8 || marker === 0xde || marker === 0xdf || (marker >= 0xf0 && marker <= 0xfd)) return undefined
    const length = (data[at + 2] << 8) | data[at + 3]
    if (length < 2) return undefined
    // the frame headers are 0xc0 to 0xcf, but for 0xc4 (Huffman tables) and 0xcc (arithmetic coding)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
      if (length < 8 || at + 9 > data.length) return undefined
      const height = (data[at + 5] << 8) | data[at + 6]
      const width = (data[at + 7] << 8) | data[at + 8]
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    at += 2 + length
  }
  return undefined
}

/**
 * What is wrong with a GLB shown with material: file, its own materials and
 * textures, or null (decision 10 in scene-files-proposal.md). The rest of
 * the file has passed modelBytesProblem's checks. `binary` is its binary
 * chunk, where its images are.
 *
 * Its textures must be PNG or JPEG images in the file, at most
 * MAX_TEXTURE_PIXELS on a side, read from their headers here. Its materials
 * mustn't be what the stage draws black or not at all: see-through (blended,
 * cut out, or transmission), metallic beyond MAX_FILE_METALNESS without a
 * metallic texture (the stage has no reflections), or missing on a mesh,
 * which three gives a fully metallic default; and a textured mesh must have
 * the texture coordinates its textures use.
 */
function ownLookProblem(json: Json, used: Set<unknown>, binary: Uint8Array | undefined): string | null {
  const notGlb = `the model isn't a binary glTF 2.0 file. Export it again as glTF Binary (.glb)`
  const images = listOf(json.images)
  const textures = listOf(json.textures)
  const materials = listOf(json.materials)
  const bufferViews = listOf(json.bufferViews)
  // GLTFLoader reads a texture's offset, scale and turn only when extensionsUsed lists the extension
  const transforms = listOf(json.extensionsUsed).includes('KHR_texture_transform')

  const other = unshownTextures(json, used)
  if (other) return other
  for (const [k, item] of images.entries()) {
    const image = asJson(item)
    const name = itemName(item, k)
    if (image?.uri !== undefined) {
      return `the model keeps its image ${name} outside the .glb (in another file or a data: address): export it as one self-contained .glb`
    }
    const view = isIndex(image?.bufferView, bufferViews.length) ? asJson(bufferViews[image!.bufferView as number]) : undefined
    if (!view) return notGlb
    const type = image!.mimeType
    if (typeof type !== 'string' || !Object.hasOwn(TEXTURE_IMAGES, type)) {
      const what = typeof type === 'string' ? `'${type}'` : 'of no type it says'
      return `the model's image ${name} is ${what}: a lecture shows PNG and JPEG textures only. Export the textures as PNG or JPEG (${BLENDER_IMAGES})`
    }
    const start = view.byteOffset ?? 0
    const length = view.byteLength
    if (!binary || !Number.isInteger(start) || !Number.isInteger(length) || (start as number) < 0 || (start as number) + (length as number) > binary.length) {
      return notGlb
    }
    const data = binary.subarray(start as number, (start as number) + (length as number))
    const size = type === 'image/png' ? pngSize(data) : jpegSize(data)
    if (!size) return `the model's image ${name} isn't the ${TEXTURE_IMAGES[type]} the file says it is: export it again`
    if (size.width > MAX_TEXTURE_PIXELS || size.height > MAX_TEXTURE_PIXELS) {
      return (
        `the model's image ${name} is ${size.width} x ${size.height} pixels: a texture may be at most ${MAX_TEXTURE_PIXELS} ` +
        `pixels on a side. Scale the image down (in Blender's Image Editor, Image > Resize, then Image > Save) and export ` +
        `again, or write a colour such as material: grey`
      )
    }
  }
  for (const [k, texture] of textures.entries()) {
    if (!isIndex(asJson(texture)?.source, images.length)) return `the model's texture ${itemName(texture, k)} has no image in the file: export it again`
  }

  // each material's look, and the texture coordinates its textures read
  const coordinates: Array<Set<unknown>> = []
  for (const [k, item] of materials.entries()) {
    const material = asJson(item)
    const name = itemName(item, k)
    const read = new Set<unknown>()
    let missing = false
    materialTextures(material, (texture) => {
      if (!isIndex(texture.index, textures.length)) missing = true
      // KHR_texture_transform may say which, as GLTFLoader reads it
      const transform = transforms ? asJson(asJson(texture.extensions)?.KHR_texture_transform) : undefined
      read.add(transform?.texCoord ?? texture.texCoord ?? 0)
    })
    if (missing) return `the model's material ${name} uses a texture the file doesn't have: export it again`
    coordinates.push(read)
    const extensions = asJson(material?.extensions) ?? {}
    if (material?.alphaMode === 'BLEND' || material?.alphaMode === 'MASK') {
      const how = material.alphaMode === 'BLEND' ? 'blended' : 'cut out'
      return `the model's material ${name} is see-through (${how}, alpha mode ${material.alphaMode}), which the stage draws wrong or not at all: ${MODEL_OPAQUE_ADVICE}`
    }
    const through = SEE_THROUGH_EXTENSIONS.find((extension) => extensions[extension] !== undefined)
    if (through) return `the model's material ${name} is see-through (${through}), which the stage can't draw: ${MODEL_OPAQUE_ADVICE}`
    // an unlit material shows its colour whatever the light; a metallic texture's pixels can't be read here
    const pbr = asJson(material?.pbrMetallicRoughness)
    // GLTFLoader hands three whatever the file says, which takes a string '1' as 1
    if (pbr?.metallicFactor !== undefined && typeof pbr.metallicFactor !== 'number') return notGlb
    const metalness = (pbr?.metallicFactor as number | undefined) ?? 1
    if (extensions.KHR_materials_unlit === undefined && pbr?.metallicRoughnessTexture === undefined && metalness > MAX_FILE_METALNESS) {
      const said = pbr?.metallicFactor === undefined ? 'metallicFactor left out, which glTF reads as 1; Blender leaves it out at Metallic 1' : `metallicFactor ${metalness}`
      return (
        `the model's material ${name} is metallic (${said}): the stage has no reflections for a metal ` +
        `to show, so it would look near black. Set its metallic to at most ${MAX_FILE_METALNESS} in the program that made it, ` +
        `or write a colour such as material: metal`
      )
    }
  }

  // each mesh's triangles: a material of its own, and texture coordinates for its textures (lines and points are left out)
  for (const [k, item] of listOf(json.meshes).entries()) {
    const mesh = asJson(item)
    for (const primitive of listOf(mesh?.primitives).map(asJson)) {
      if (![undefined, 4, 5, 6].includes(primitive?.mode as number | undefined)) continue
      const index = primitive?.material
      if (index === undefined) {
        return (
          `the model's mesh ${itemName(item, k)} has no material, which three.js draws fully metallic, near black on the stage: ` +
          `give it a material in the program that made it, or write a colour such as material: grey`
        )
      }
      if (!isIndex(index, materials.length)) return notGlb
      const attributes = asJson(primitive?.attributes) ?? {}
      for (const n of coordinates[index]) {
        // GLTFLoader reads TEXCOORD_0 to TEXCOORD_3
        if (!isIndex(n, 4) || attributes[`TEXCOORD_${n}`] === undefined) {
          return (
            `the model's mesh ${itemName(item, k)} has a texture but not the texture coordinates it uses (TEXCOORD_${String(n)}, a UV map): ` +
            `unwrap it in the program that made it, or write a colour such as material: grey`
          )
        }
      }
    }
  }
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
