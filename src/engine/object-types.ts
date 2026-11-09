/**
 * Objects a scene file adds to its scene (docs/scene-files.md, "Objects"):
 * plain data, checked by the compiler (src/compiler/scene-files.ts) and built
 * into three.js objects when the scene is first built (src/scene/objects.ts).
 */

/** the shapes an object can have, each a key of its own in the file; with none, it is an invisible point */
export const OBJECT_SHAPES = ['box', 'cylinder', 'sphere', 'frame'] as const
export type ObjectShape = (typeof OBJECT_SHAPES)[number] | 'point'

/** the colours a box, cylinder or sphere can have, each the CSS token `--object-<name>` (src/styles.css) */
export const OBJECT_MATERIALS = ['grey', 'white', 'black', 'red', 'yellow', 'green', 'blue', 'wood', 'metal'] as const
export type ObjectMaterial = (typeof OBJECT_MATERIALS)[number]

export interface SceneObject {
  name: string
  shape: ObjectShape
  /** in metres: box [width, height, depth], cylinder [diameter, height], sphere [diameter], frame [axis length], point [] */
  size: number[]
  /** the middle of its underside (a frame's origin, a point itself), in its parent's frame, metres */
  at: [number, number, number]
  /** degrees about x, then the turned y, then the turned z (three.js Euler order XYZ) */
  rotate: [number, number, number]
  /** box, cylinder and sphere only (grey when the file gives none) */
  material?: ObjectMaterial
  /** an object of the same scene earlier in the list, or an anchor of the base scene; none: the scene itself */
  parent?: string
}
