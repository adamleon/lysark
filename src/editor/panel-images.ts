import type { ImageRef } from '../compiler/compile-slides'
import { imageType } from '../compiler/image-types'
import type { HostFile } from './host'

/**
 * Real images in the panel (scene-files-proposal.md, step 1). The compiler
 * reports each image a lecture uses; the panel asks VS Code for the files and
 * shows them as data URIs, as the build puts them into the student file
 * (vite-plugin-slides.ts). The rules match the build's, so an image the panel
 * can't show names the problem the build would report. Letter case is the
 * exception: VS Code on Windows finds `Arm.png` for `arm.png`, the build on
 * Linux doesn't.
 */

/**
 * The paths to try for an image's src, relative to the lecture folder, or why
 * it can't be shown. markdown-it percent-encodes the path (a space becomes
 * %20), so the decoded spelling is tried too.
 */
export function imagePaths(src: string): { paths: string[] } | { problem: string } {
  if (/^[a-z]:(?:[\\/]|%5c)/i.test(src)) return { problem: `'${src}' is an absolute path on this computer` }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
    return { problem: `'${src}' is a web address; the lecture file must work offline` }
  }
  if (/\\|%5c/i.test(src)) return { problem: `'${src}' contains a backslash; use /` }
  if (src.startsWith('/')) return { problem: `'${src}' starts with '/'; give the path relative to slides.md` }
  const spellings = [src]
  try {
    const decoded = decodeURI(src)
    if (decoded !== src) spellings.push(decoded)
  } catch {
    // not valid percent-encoding: the path is literal
  }
  const paths = [...new Set(spellings.map((s) => s.split(/[?#]/)[0].replace(/^(\.\/)+/, '')))]
  if (!imageType(paths[0])) return { problem: `'${src}' is not a supported image type` }
  return { paths }
}

/**
 * Data URIs for the images, by src, from files read with `read`; and the
 * problems with those it couldn't get (shown as placeholders).
 */
export async function loadImages(
  images: ImageRef[],
  read: (paths: string[]) => Promise<Record<string, HostFile>>,
): Promise<{ uris: Record<string, string>; problems: string[] }> {
  const uris: Record<string, string> = {}
  const problems: string[] = []
  const wanted = new Map<string, string[]>()
  for (const { src } of images) {
    if (wanted.has(src)) continue
    const found = imagePaths(src)
    if ('problem' in found) problems.push(found.problem)
    else wanted.set(src, found.paths)
  }
  if (wanted.size === 0) return { uris, problems }
  const files = await read([...new Set([...wanted.values()].flat())])
  for (const [src, paths] of wanted) {
    const hit = paths.find((p) => typeof files[p]?.base64 === 'string')
    if (hit) uris[src] = `data:${imageType(hit)};base64,${files[hit].base64}`
    else problems.push(`'${src}': ${files[paths[0]]?.error ?? 'not found'}`)
  }
  return { uris, problems }
}
