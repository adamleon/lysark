import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { modelFormat, type ModelFormat } from '../compiler/model-types'
import type { ModelLoader, SceneObject } from '../engine/object-types'

/**
 * Models from STL and GLB files (docs/scene-files.md, "Models"). This module
 * holds three.js's loaders, so only what shows models imports it: a deck with
 * a model in a scene it runs (vite-plugin-lecture.ts), the checks the build
 * and the editor panel share (model-check.ts), and the editor. Placing a
 * model on its object, and its colour, is src/scene/objects.ts's (fitModel).
 *
 * The files have been checked before they get here (model-check.ts), so
 * parsing needs no request, worker or wasm, and leaves only meshes whose GPU
 * memory src/scene/dispose.ts frees (spec §4.1, §9).
 */

/** creases: smooth across shallow angles, sharp above this, as the KUKA's meshes (src/scenes/agilus.ts) */
const CREASE_ANGLE = THREE.MathUtils.degToRad(40)
/**
 * toCreasedNormals counts corners within 0.01 of the file's unit of each
 * other as one corner: a hundredth of a millimetre in a millimetre file, but
 * a whole centimetre in a metre file, where a small part's normals smear. So
 * it sees the model scaled to this many units across, which makes that a
 * ten-thousandth of the model's largest side in any unit.
 */
const CREASE_SIDE = 100
/** the attributes the preset material uses; a file's colours, texture coordinates and the like would be GPU memory for nothing */
const KEPT_ATTRIBUTES = new Set(['position', 'normal'])

/** a file's bytes from base64, in an ArrayBuffer exactly as long as the file (the loaders read the whole buffer) */
export function decodeBase64(base64: string): ArrayBuffer {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes.buffer
}

/**
 * A model file's meshes, in the file's own units and axes, on a group of
 * their own. Rejects when the loader can't read the file. Only meshes are
 * left: a GLB's lights, cameras, lines and points go (the stage's own lights
 * stay the only ones), and its animations are not used.
 */
export async function parseModel(buffer: ArrayBuffer, format: ModelFormat): Promise<THREE.Group> {
  if (format === 'stl') {
    // CAD programs write flat or zero normals, so every STL gets creased ones
    const geometry = creased(keepShapeOnly(parseStl(buffer)))
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geometry))
    return group
  }
  // the checks refuse a file that asks for another (model-types.ts); in case
  // one slips past, every address the loaders are given throws before any
  // fetch, blob: or image load starts. FileLoader, ImageLoader and
  // ImageBitmapLoader each pass it through the manager first, and GLTFLoader
  // calls them inside a promise, so a buffer's throw rejects the parse.
  // A texture's is only logged, and the loader reads on without it: `asked`
  // rejects the parse then too
  let asked: Error | undefined
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    asked ??= new Error(`it asks for another file, '${shortened(url)}': export it as one self-contained .glb`)
    throw asked
  })
  // parseAsync, so the loader's own synchronous throws (JSON.parse) reject too
  const gltf = await new GLTFLoader(manager).parseAsync(buffer, '')
  if (asked) throw asked
  const root = gltf.scene ?? gltf.scenes[0] ?? new THREE.Group()
  meshesOnly(root)
  // a mesh used by several nodes shares its geometry: fix each geometry once
  const fixed = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    let geometry = fixed.get(mesh.geometry)
    if (!geometry) {
      geometry = keepShapeOnly(mesh.geometry)
      // some exporters leave normals out, which would light the model black
      if (!geometry.hasAttribute('normal')) geometry = creased(geometry)
      fixed.set(mesh.geometry, geometry)
    }
    mesh.geometry = geometry
  })
  return root
}

/**
 * Builds the models of a scene's objects from the lecture's model files, as
 * base64 by the path the scene file writes (the student file's
 * `export const models` from vite-plugin-slides.ts, or the files the editor
 * panel read). Each object parses its own copy, so no two objects share
 * geometry. Never rejects: an object whose file it hasn't got (the build and
 * the panel have said why already) or can't read keeps its empty node.
 */
export function modelLoader(files: Record<string, string>): ModelLoader {
  return {
    async load(objects: SceneObject[]): Promise<Map<string, THREE.Object3D>> {
      const models = new Map<string, THREE.Object3D>()
      for (const spec of objects) {
        if (spec.shape !== 'model' || !spec.model) continue
        const { src } = spec.model
        if (!Object.hasOwn(files, src)) continue
        try {
          const format = modelFormat(src)
          if (!format) throw new Error('not an .stl or .glb file')
          models.set(spec.name, await parseModel(decodeBase64(files[src]), format))
        } catch (error) {
          // the checks should have caught it; check-offline fails on this error
          console.error(`object '${spec.name}': the model '${src}' couldn't be read: ${firstLine(error)}`)
        }
      }
      return models
    },
  }
}

/** an address as an error names it: a data: address can be the whole file */
function shortened(url: string): string {
  return url.length > 60 ? `${url.slice(0, 59)}…` : url
}

/** an error's message, its first line only (a loader's can run on) */
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0].trim() || 'no reason given'
}

/**
 * An STL's geometry, from STLLoader. For a text STL with a face that hasn't
 * one normal and three corners, the loader logs console.error for each and
 * reads on, which here is an error instead: the file is wrong, the build and
 * the panel say so (model-check.ts), and the lecture file never logs it.
 * Parsing is synchronous, so nothing else can log while console.error is
 * borrowed.
 */
function parseStl(buffer: ArrayBuffer): THREE.BufferGeometry {
  const complaints: string[] = []
  const log = console.error
  console.error = (...args: unknown[]) => complaints.push(args.map(String).join(' '))
  let geometry: THREE.BufferGeometry
  try {
    geometry = new STLLoader().parse(paddedStl(buffer))
  } finally {
    console.error = log
  }
  if (complaints.length > 0) throw new Error(complaints[0])
  return geometry
}

/**
 * STLLoader reads a binary STL's triangle count at byte 80 before it looks for
 * 'solid', so a text STL shorter than that (one with no triangles) would throw;
 * spaces after its end make it long enough and change nothing in it.
 */
function paddedStl(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength >= 84) return buffer
  const padded = new Uint8Array(84).fill(0x20)
  padded.set(new Uint8Array(buffer))
  return padded.buffer
}

/** the geometry with only the attributes the preset material uses */
function keepShapeOnly(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (!KEPT_ATTRIBUTES.has(name)) geometry.deleteAttribute(name)
  }
  return geometry
}

/** the geometry, unindexed, with normals smooth across shallow angles and sharp across steep ones */
function creased(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  const position = flat.getAttribute('position')
  const size = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute).getSize(new THREE.Vector3())
  const largest = Math.max(size.x, size.y, size.z)
  const scale = largest > 0 && Number.isFinite(largest) ? CREASE_SIDE / largest : 1
  const scaled = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    scaled[3 * i] = position.getX(i) * scale
    scaled[3 * i + 1] = position.getY(i) * scale
    scaled[3 * i + 2] = position.getZ(i) * scale
  }
  // a uniform scale leaves every normal as it is: only the corners it counts as one change
  const probe = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(scaled, 3))
  flat.setAttribute('normal', toCreasedNormals(probe, CREASE_ANGLE).getAttribute('normal'))
  return flat
}

/**
 * Takes a GLB's lights, cameras, lines and points out of its scene, so only
 * meshes are left: dispose.ts frees no line, loop or points, and the stage's
 * lights are the only ones. GLTFLoader makes a node holding only one of these
 * that thing itself, with the file's child nodes under it; those children
 * stay, on an empty node with the same transform in its place.
 */
function meshesOnly(root: THREE.Object3D): void {
  const dropped: THREE.Object3D[] = []
  root.traverse((node) => {
    if (node === root) return
    const { isLight, isCamera, isLine, isPoints } = node as THREE.Object3D & Record<'isLight' | 'isCamera' | 'isLine' | 'isPoints', boolean | undefined>
    if (isLight || isCamera || isLine || isPoints) dropped.push(node)
  })
  // traverse lists a node before what is under it, so backwards each child is
  // already in its final place when its parent goes
  for (const node of dropped.reverse()) {
    // a spot or directional light's target hangs on it, and goes with it
    const target = (node as THREE.DirectionalLight).target
    const children = node.children.filter((child) => child !== target)
    if (children.length > 0) {
      const stand = new THREE.Group()
      stand.name = node.name
      stand.position.copy(node.position)
      stand.quaternion.copy(node.quaternion)
      stand.scale.copy(node.scale)
      stand.add(...children)
      node.parent?.add(stand)
    }
    node.removeFromParent()
  }
}
