import { lectureObjects, readSceneFiles } from '../compiler/scene-files'
import { defineDeck } from '../engine/deck'
import { ALL_SCENES } from '../scenes/all'
import { compileForEditor } from './editor-compile'

/**
 * The editor runtime's deck: compiled in the browser from the lecture text the
 * VS Code extension sent, with its scene files and the images the panel read
 * (src/editor/runtime.ts sets them before the deck loads).
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
  }
}

const WAITING = '---\nlayout: center\n---\n## Waiting for the lecture text from VS Code\n'

const files = window.__LYSARK_FILES__ ?? { 'slides.md': WAITING }

export default defineDeck({
  scenes: ALL_SCENES,
  slides: compileForEditor(files['slides.md'] ?? WAITING, window.__LYSARK_IMAGES__, files),
  // the scene files' objects (runtime.ts loads the panel afresh when they change)
  objects: lectureObjects(readSceneFiles(files)),
})
