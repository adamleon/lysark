import * as THREE from 'three'
import {
  MODEL_BLEND_ADVICE,
  MODEL_BONES_PROBLEM,
  MODEL_INSTANCING_PROBLEM,
  MODEL_OPAQUE_ADVICE,
  modelBytesProblem,
  modelExtentProblem,
  type ModelFormat,
  type ModelLimits,
  type ModelLook,
} from '../compiler/model-types'
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

/**
 * With material: file, a see-through material in what the loader built
 * (blended, or transmission), or null: the bytes' check reads them from the
 * JSON as glTF lays them out, and this is what GLTFLoader made of it. A
 * cut-out material (alphaTest, from alpha mode MASK) is drawn in the opaque
 * pass, and allowed.
 */
function builtLookProblem(model: THREE.Object3D): string | null {
  let problem: string | null = null
  model.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (problem !== null || !mesh.isMesh) return
    for (const material of [mesh.material].flat() as THREE.MeshPhysicalMaterial[]) {
      if (material.transparent || (material.transmission ?? 0) > 0) {
        const name = material.name ? `'${material.name}'` : `of the mesh '${mesh.name}'`
        const advice = material.transparent ? MODEL_BLEND_ADVICE : MODEL_OPAQUE_ADVICE
        problem = `the model's material ${name} is see-through, which the stage draws wrong or not at all: ${advice}`
        return
      }
    }
  })
  return problem
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
 * reads the file in its own unit; `look` is where its look comes from (its
 * object's material: line); `src` is its path as the scene file writes it,
 * which a message about all its textures together names; `limits` is 'off'
 * when its scene file says limits: off, which lifts the size limits and only
 * them (model-types.ts, ModelLimits). Never rejects: what three.js throws on
 * is a file that couldn't be read.
 *
 * With material: file, the textures' images are not loaded here (the build
 * runs in Node, which has no <img>): their type and size are read from their
 * headers (model-types.ts), and an image that is broken past its header
 * fails when the deck loads it, which `lysark check` catches.
 */
export async function checkModel(
  buffer: ArrayBuffer,
  format: ModelFormat,
  units: readonly ModelUnit[],
  look: ModelLook = 'default',
  src?: string,
  limits: ModelLimits = 'on',
): Promise<string | null> {
  const bytes = modelBytesProblem(buffer, format, look, src, limits)
  if (bytes) return bytes
  let largest: number
  // all of it in the try: a file laid out as no exporter writes it can make
  // three.js throw anywhere, and the build and the panel still get a message
  try {
    const model = await parseModel(buffer, format, { ownLook: look === 'file', images: false })
    const built = builtProblem(model) ?? (look === 'file' ? builtLookProblem(model) : null)
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
