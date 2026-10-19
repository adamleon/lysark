import { defineDeck } from '../engine/deck'
import { ALL_SCENES } from '../scenes/all'
import { compileForEditor } from './editor-compile'

/**
 * The editor runtime's deck: compiled in the browser from the lecture text the
 * VS Code extension sent, with the images the panel read (src/editor/runtime.ts
 * sets both before the deck loads).
 * In the editor build this module stands in for `virtual:lysark-deck`. Its
 * slide objects are the ones the engine reads, so the runtime can update their
 * cameras in place (editor-compile.ts, updateCameras).
 */

declare global {
  interface Window {
    __LYSARK_SOURCE__?: string
    /** the lecture's images as data URIs, by src (panel-images.ts) */
    __LYSARK_IMAGES__?: Record<string, string>
  }
}

const WAITING = '---\nlayout: center\n---\n## Waiting for the lecture text from VS Code\n'

export default defineDeck({ scenes: ALL_SCENES, slides: compileForEditor(window.__LYSARK_SOURCE__ ?? WAITING, window.__LYSARK_IMAGES__) })
