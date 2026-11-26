import { modelObjectKey } from '../compiler/model-types'
import { lectureObjects, readSceneFiles } from '../compiler/scene-files'
import { defineDeck } from '../engine/deck'
import { modelLoader } from '../scene/models'
import { ALL_SCENES } from '../scenes/all'
import { compileForEditor } from './editor-compile'

/**
 * The editor runtime's deck: compiled in the browser from the lecture text the
 * VS Code extension sent, with its scene files and the images and models the
 * panel read (src/editor/runtime.ts sets them before the deck loads).
 * In the editor build this module stands in for `virtual:lysark-deck`. Its
 * slide objects are the ones the engine reads, so the runtime can update their
 * cameras and joints in place (editor-compile.ts, updateTargets).
 */

declare global {
  interface Window {
    /** slides.md and the lecture's scene files, by path (runtime.ts) */
    __LYSARK_FILES__?: Record<string, string>
    /** the lecture's images as data URIs, by src (panel-images.ts) */
    __LYSARK_IMAGES__?: Record<string, string>
    /** the lecture's model files as base64, by the path the scene files write; only those that passed the checks (panel-models.ts) */
    __LYSARK_MODELS__?: Record<string, string>
    /** the model objects (modelObjectKey) whose file is above but was refused in their unit, look or limits: they get no model */
    __LYSARK_MODELS_LEFT_OUT__?: string[]
  }
}

const WAITING = '---\nlayout: center\n---\n## Waiting for the lecture text from VS Code\n'

const files = window.__LYSARK_FILES__ ?? { 'slides.md': WAITING }
const sceneFiles = readSceneFiles(files)
const leftOutKeys = new Set(window.__LYSARK_MODELS_LEFT_OUT__ ?? [])
/** the objects whose file the panel gives other objects, but refused in their unit, look or limits */
const leftOut = new Set(
  [...sceneFiles.values()].flatMap((file) => file.objects.filter((object) => leftOutKeys.has(modelObjectKey({ file: file.path, object: object.name })))),
)

export default defineDeck({
  scenes: ALL_SCENES,
  slides: compileForEditor(files['slides.md'] ?? WAITING, window.__LYSARK_IMAGES__, files),
  // the scene files' objects. The scene manager reads this same record when it first builds a
  // scene; runtime.ts (placeObjects) writes a new at or rotate into it in place, and loads the
  // panel afresh for any other change to them
  objects: lectureObjects(sceneFiles),
  // a model the panel left out (it says why) isn't among the files, or its object is in leftOut:
  // the object stays an empty node. Any change to a model object but its place loads the panel
  // afresh, which reads the file again
  models: modelLoader(window.__LYSARK_MODELS__ ?? {}, leftOut),
})
