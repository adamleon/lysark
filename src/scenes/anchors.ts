import type { SCENE_NAMES } from './registry'

/**
 * Each engine scene's anchors (the points slides look at and label by name),
 * for the compiler: an object in a scene file can't take an anchor's name, and
 * can hang on (`parent:`) the anchors in `parents` (docs/scene-files.md). The
 * scenes themselves list the same in `anchors:`; anchors.test.ts checks that
 * this table agrees. The compiler can't import the scenes: they bring three.js
 * and the meshes.
 */
export interface SceneAnchors {
  anchors: string[]
  /** the anchors an object can hang on */
  parents: string[]
}

export const SCENE_ANCHORS: Record<(typeof SCENE_NAMES)[number], SceneAnchors> = {
  arm: { anchors: ['base', 'end_effector'], parents: ['base', 'end_effector'] },
  pendulum: { anchors: ['pivot', 'bob'], parents: ['pivot', 'bob'] },
  agilus: { anchors: ['base', 'tool0'], parents: ['base', 'tool0'] },
  // both are on robot 0, which a slide can draw as the ghost: an object on it would turn ghost too
  'agilus-duo': { anchors: ['base', 'tool0'], parents: [] },
}
