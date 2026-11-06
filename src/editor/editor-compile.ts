import { compileLecture, IMAGE_TOKEN } from '../compiler/compile-slides'
import type { CompiledSlide } from '../engine/slide-types'

/**
 * Compile lecture text for the editor runtime: the normal compiler, with each
 * image filled from `images` (data URIs by src, read from the lecture folder
 * through VS Code; panel-images.ts), or shown as a placeholder naming its file
 * when the panel couldn't get it; the lecture's scene files as `sceneFiles`
 * (by path, docs/scene-files.md). Pure: the deck (deck-from-source.ts) and the
 * runtime's camera update (runtime.ts) both use it, with the same images.
 */
export function compileForEditor(
  text: string,
  images: Record<string, string> = {},
  sceneFiles: Record<string, string> = {},
): CompiledSlide[] {
  const { slides, images: refs } = compileLecture(text, sceneFiles)
  return JSON.parse(
    JSON.stringify(slides).replace(new RegExp(`${IMAGE_TOKEN}(\\d+)`, 'g'), (_, n: string) => {
      const src = refs[Number(n)].src
      return images[src] ?? imagePlaceholder(src)
    }),
  )
}

function imagePlaceholder(src: string): string {
  const label = src.replace(/[<>&"']/g, '')
  // a data: image can't read the page's CSS colour tokens
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">` +
    `<rect width="320" height="120" rx="8" fill="#8a8f98" fill-opacity="0.25" stroke="#8a8f98"/>` +
    `<text x="160" y="56" text-anchor="middle" font-family="system-ui" font-size="14" fill="#8a8f98">image not shown</text>` +
    `<text x="160" y="80" text-anchor="middle" font-family="system-ui" font-size="12" fill="#8a8f98">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Copy the cameras, joints and trajectory ends of `fresh` into `running` (the
 * deck's own slide objects, which the engine reads when it enters a slide),
 * if those are all that differ. Returns the indices whose camera, joints or
 * trajectory changed, or null if anything else differs and the panel must
 * load afresh.
 */
export function updateTargets(running: CompiledSlide[], fresh: CompiledSlide[]): number[] | null {
  if (running.length !== fresh.length) return null
  const rest = (s: CompiledSlide) =>
    JSON.stringify({
      ...s,
      effective: { ...s.effective, camera: undefined, joints: undefined },
      // a trajectory's ends may be poses (docs/scene-files.md), which change with them
      trajectory: s.trajectory ? { ...s.trajectory, from: undefined, to: undefined } : undefined,
    })
  for (let i = 0; i < running.length; i++) {
    if (rest(running[i]) !== rest(fresh[i])) return null
  }
  const changed: number[] = []
  for (let i = 0; i < running.length; i++) {
    let differs = false
    for (const key of ['camera', 'joints'] as const) {
      const value = fresh[i].effective[key]
      if (JSON.stringify(running[i].effective[key]) === JSON.stringify(value)) continue
      differs = true
      if (value) (running[i].effective as Record<string, unknown>)[key] = value
      else delete running[i].effective[key]
    }
    if (JSON.stringify(running[i].trajectory) !== JSON.stringify(fresh[i].trajectory)) {
      differs = true
      running[i].trajectory = fresh[i].trajectory
    }
    if (differs) changed.push(i)
  }
  return changed
}
