import type { SceneModule } from '../engine/scene-types'
import arm from './arm'
import pendulum from './pendulum'
import agilus from './agilus'
import agilusDuo from './agilus-duo'

/**
 * Every scene, for the editor runtime, which compiles whatever lecture text it
 * is sent and so can't know in advance which scenes it needs. A lecture's own
 * student file still imports only the scenes it uses (vite-plugin-lecture.ts).
 * Keep in step with registry.ts; a test checks that they match.
 */
export const ALL_SCENES: Record<string, SceneModule> = {
  arm,
  pendulum,
  agilus,
  'agilus-duo': agilusDuo,
}
