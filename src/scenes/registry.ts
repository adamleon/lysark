/**
 * Scenes a lecture can name in its `scene:` frontmatter. Each name is also the
 * file name in this folder and the module's `id`. The build imports only the
 * scenes a lecture uses, so a lecture without the Agilus doesn't carry its
 * meshes.
 */
export const SCENE_NAMES = ['arm', 'pendulum', 'agilus', 'agilus-duo'] as const
