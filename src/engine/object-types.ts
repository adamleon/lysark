import type { Object3D } from 'three'

/**
 * Objects a scene file adds to its scene (docs/scene-files.md, "Objects"):
 * plain data, checked by the compiler (src/compiler/scene-files.ts) and built
 * into three.js objects when the scene is first built (src/scene/objects.ts).
 */

/**
 * the shapes an object can have, each a key of its own in the file; with none, it is an invisible point.
 * A model is a shape whose geometry comes from a file (docs/scene-files.md, "Models").
 */
export const OBJECT_SHAPES = ['box', 'cylinder', 'sphere', 'frame', 'model'] as const
export type ObjectShape = (typeof OBJECT_SHAPES)[number] | 'point'

/** the colours a box, cylinder, sphere or model can have, each the CSS token `--object-<name>` (src/styles.css) */
export const OBJECT_MATERIALS = ['grey', 'white', 'black', 'red', 'yellow', 'green', 'blue', 'wood', 'metal'] as const
export type ObjectMaterial = (typeof OBJECT_MATERIALS)[number]

/** what a model's file is measured in (`unit:`), and the axis that is up in it (`up:`) */
export type ModelUnit = 'mm' | 'cm' | 'm'
export type ModelUp = 'y' | 'z'

/** anything larger, or farther out, is metres written as millimetres (the floor grid is 5 m across) */
export const MAX_METRES = 10

export interface SceneObject {
  name: string
  shape: ObjectShape
  /** in metres: box [width, height, depth], cylinder [diameter, height], sphere [diameter], frame [axis length], point [], model [] (its size comes from its file) */
  size: number[]
  /** the middle of its underside (a frame's origin, a point itself), in its parent's frame, metres; a model's underside is its bounding box's */
  at: [number, number, number]
  /** degrees about x, then the turned y, then the turned z (three.js Euler order XYZ) */
  rotate: [number, number, number]
  /** box, cylinder, sphere and model only (grey when the file gives none); a model's own colours are not used */
  material?: ObjectMaterial
  /** an object of the same scene earlier in the list, or an anchor of the base scene; none: the scene itself */
  parent?: string
  /**
   * a model only: its file, as written (from the lecture folder, where slides.md is), what the file is
   * measured in and which of its axes is up. Never the bytes: the deck's ModelLoader has those.
   */
  model?: { src: string; unit: ModelUnit; up: ModelUp }
}

/**
 * Builds the models of a scene's objects (src/scene/models.ts). A deck has one
 * only when a scene it runs has a model, so a lecture without models carries
 * no model loaders.
 */
export interface ModelLoader {
  /**
   * Each model object's model, by object name, built from its file, before the
   * objects are added to the scene. Never rejects: a model it can't build is
   * left out (with a console.error), and its object stays an empty node.
   */
  load(objects: SceneObject[]): Promise<Map<string, Object3D>>
}
