import { compileLecture, IMAGE_TOKEN } from '../compiler/compile-slides'
import type { CompiledSlide } from '../engine/slide-types'

/**
 * Compile lecture text for the editor runtime: the normal compiler, with each
 * image shown as a placeholder naming its file, since the extension doesn't
 * send image files yet (lysark-v2.md step 3). Pure: the deck
 * (deck-from-source.ts) and the runtime's camera update (runtime.ts) both use it.
 */
export function compileForEditor(text: string): CompiledSlide[] {
  const { slides, images } = compileLecture(text)
  return JSON.parse(
    JSON.stringify(slides).replace(new RegExp(`${IMAGE_TOKEN}(\\d+)`, 'g'), (_, n: string) =>
      imagePlaceholder(images[Number(n)].src),
    ),
  )
}

function imagePlaceholder(src: string): string {
  const label = src.replace(/[<>&"']/g, '')
  // a data: image can't read the page's CSS colour tokens
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">` +
    `<rect width="320" height="120" rx="8" fill="#8a8f98" fill-opacity="0.25" stroke="#8a8f98"/>` +
    `<text x="160" y="56" text-anchor="middle" font-family="system-ui" font-size="14" fill="#8a8f98">image</text>` +
    `<text x="160" y="80" text-anchor="middle" font-family="system-ui" font-size="12" fill="#8a8f98">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Copy the cameras of `fresh` into `running` (the deck's own slide objects,
 * which the engine reads when it flies to a slide), if cameras are all that
 * differ. Returns the indices whose camera changed, or null if anything else
 * differs and the panel must load afresh.
 */
export function updateCameras(running: CompiledSlide[], fresh: CompiledSlide[]): number[] | null {
  if (running.length !== fresh.length) return null
  const withoutCamera = (s: CompiledSlide) => JSON.stringify({ ...s, effective: { ...s.effective, camera: undefined } })
  for (let i = 0; i < running.length; i++) {
    if (withoutCamera(running[i]) !== withoutCamera(fresh[i])) return null
  }
  const changed: number[] = []
  for (let i = 0; i < running.length; i++) {
    const camera = fresh[i].effective.camera
    if (JSON.stringify(running[i].effective.camera) === JSON.stringify(camera)) continue
    changed.push(i)
    if (camera) running[i].effective.camera = camera
    else delete running[i].effective.camera
  }
  return changed
}
