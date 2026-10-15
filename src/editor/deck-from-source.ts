import { compileLecture, IMAGE_TOKEN } from '../compiler/compile-slides'
import { defineDeck } from '../engine/deck'
import { ALL_SCENES } from '../scenes/all'

/**
 * The editor runtime's deck: compiled in the browser from the lecture text the
 * VS Code extension sent (src/editor/runtime.ts sets it before the deck loads).
 * In the editor build this module stands in for `virtual:lysark-deck`.
 */

declare global {
  interface Window {
    __LYSARK_SOURCE__?: string
  }
}

const WAITING = '---\nlayout: center\n---\n## Waiting for the lecture text from VS Code\n'

// Images aren't sent to the editor yet (lysark-v2.md step 3): show where each one goes.
function imagePlaceholder(src: string): string {
  const label = src.replace(/[<>&"']/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">` +
    `<rect width="320" height="120" rx="8" fill="#8a8f98" fill-opacity="0.25" stroke="#8a8f98"/>` +
    `<text x="160" y="56" text-anchor="middle" font-family="system-ui" font-size="14" fill="#8a8f98">image</text>` +
    `<text x="160" y="80" text-anchor="middle" font-family="system-ui" font-size="12" fill="#8a8f98">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const { slides, images } = compileLecture(window.__LYSARK_SOURCE__ ?? WAITING)
const withImages = JSON.parse(
  JSON.stringify(slides).replace(new RegExp(`${IMAGE_TOKEN}(\\d+)`, 'g'), (_, n: string) =>
    imagePlaceholder(images[Number(n)].src),
  ),
)

export default defineDeck({ scenes: ALL_SCENES, slides: withImages })
