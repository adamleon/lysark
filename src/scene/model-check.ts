import * as THREE from 'three'
import { MODEL_BONES_PROBLEM, MODEL_INSTANCING_PROBLEM, modelBytesProblem, modelExtentProblem, type ModelFormat } from '../compiler/model-types'
import type { ModelUnit } from '../engine/object-types'
import { firstLine, parseModel } from './models'

/**
 * The whole check of a model file (docs/scene-files.md, "Models"), shared by
 * the build (vite-plugin-slides.ts, in Node) and the editor panel (in the
 * browser), so both refuse the same files with the same words. First what the
 * bytes say without parsing (src/compiler/model-types.ts), then the file is
 * parsed with the same loaders the lecture uses, and what was read is counted
 * and measured.
 */

/** the triangles a model's meshes draw */
function triangleCount(model: THREE.Object3D): number {
  let count = 0
  model.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const corners = mesh.geometry.index ?? mesh.geometry.getAttribute('position')
    if (corners) count += Math.floor(corners.count / 3)
  })
  return count
}

/**
 * Bones or GPU instancing in what the loader built, or null. The bytes'
 * check reads them from the JSON as glTF lays it out; this is what GLTFLoader
 * made of it, so no other layout gets either past.
 */
function builtProblem(model: THREE.Object3D): string | null {
  let skinned = false
  let instanced = false
  model.traverse((node) => {
    skinned ||= (node as THREE.SkinnedMesh).isSkinnedMesh === true
    instanced ||= (node as THREE.InstancedMesh).isInstancedMesh === true
  })
  return skinned ? MODEL_BONES_PROBLEM : instanced ? MODEL_INSTANCING_PROBLEM : null
}

/** true when STLLoader reads the file as text: its length doesn't fit a binary STL, and 'solid' starts within its first 5 bytes */
function readAsText(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 84 && 84 + 50 * new DataView(buffer).getUint32(80, true) === bytes.length) return false
  return [0, 1, 2, 3, 4].some((offset) => [...'solid'].every((letter, k) => bytes[offset + k] === letter.charCodeAt(0)))
}

/**
 * What is wrong with a model file, or null. `buffer` holds exactly the
 * file's bytes; `units` are those of every object that shows it, as each
 * reads the file in its own unit. Never rejects: what three.js throws on is
 * a file that couldn't be read.
 */
export async function checkModel(buffer: ArrayBuffer, format: ModelFormat, units: readonly ModelUnit[]): Promise<string | null> {
  const bytes = modelBytesProblem(buffer, format)
  if (bytes) return bytes
  let largest: number
  // all of it in the try: a file laid out as no exporter writes it can make
  // three.js throw anywhere, and the build and the panel still get a message
  try {
    const model = await parseModel(buffer, format)
    const built = builtProblem(model)
    if (built) return built
    if (triangleCount(model) === 0) {
      // a binary STL whose header starts with 'solid' and gives the wrong triangle count is read as text, and has none
      return format === 'stl' && readAsText(buffer)
        ? `the model has no triangles to show (a binary STL whose header starts with 'solid' is read as text: export it again)`
        : `the model has no triangles to show`
    }
    const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3())
    largest = Math.max(size.x, size.y, size.z)
  } catch (error) {
    return `the model couldn't be read: ${firstLine(error)}`
  }
  for (const unit of new Set(units)) {
    const extent = modelExtentProblem(largest, unit)
    if (extent) return extent
  }
  return null
}
