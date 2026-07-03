import type { CameraTargetSpec } from './slide-types'

/**
 * Per-key camera-spec merge (spec §4.3), shared by the build-time compiler
 * (slide-to-slide inheritance) and the runtime engine (scene defaults ⊕
 * effective). `spring` merges deep so a partial override keeps the inherited
 * sibling key; a newly declared offset/distance replaces the other, since
 * they are alternative framings.
 */
export function mergeCameraSpec(
  base: CameraTargetSpec | undefined,
  over: CameraTargetSpec | undefined,
): CameraTargetSpec | undefined {
  if (!over) return base
  if (!base) return over
  const merged: CameraTargetSpec = { ...base, ...over }
  if (base.spring && over.spring) merged.spring = { ...base.spring, ...over.spring }
  if (over.offset && over.distance === undefined) delete merged.distance
  if (over.distance !== undefined && !over.offset) delete merged.offset
  return merged
}
