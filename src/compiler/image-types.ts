/**
 * The image files a lecture can use, by extension, with the type a data URI
 * names. The build (vite-plugin-slides.ts) and the editor panel
 * (src/editor/panel-images.ts) both inline images with it.
 */
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

/** the type of the image file at `path`, by its extension (any case); undefined if not an image */
export function imageType(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? IMAGE_TYPES[path.slice(dot).toLowerCase()] : undefined
}
