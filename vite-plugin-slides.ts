import { normalizePath, type Plugin, type ViteDevServer } from 'vite'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { compileLecture, IMAGE_TOKEN, type ImageRef } from './src/compiler/compile-slides'

/**
 * Compiles a lecture's slides.md to slide objects at build time (spec §8),
 * and builds its images into the result (lysark-v2.md step 2): the compiler
 * reports the images, this plugin reads them and inlines each file once, as a
 * data URI, so the student file needs nothing next to it. The browser imports
 * plain data; markdown-it/yaml/katex never ship.
 */

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

/** true when file is somewhere under dir (Windows paths compare without case) */
function isInside(dir: string, file: string): boolean {
  const r = relative(dir.toLowerCase(), file.toLowerCase())
  return r !== '' && !isAbsolute(r) && r.split(/[\\/]/)[0] !== '..'
}

/**
 * The image file an <img src> names. Paths are relative to slides.md, and the
 * file must be inside the lecture folder or the course's assets/ folder: the
 * published site only rebuilds a lecture when those change (scripts/site.mjs).
 * Letter case must match exactly, because the course is built on Linux.
 * onMissing gets the paths where a missing image was looked for.
 */
export function resolveImage(
  image: ImageRef,
  slidesPath: string,
  courseRoot: string,
  onMissing?: (paths: string[]) => void,
): string {
  const where = `${basename(dirname(slidesPath))}/slides.md, slide '${image.slide}'`
  const { src } = image
  if (/^[a-z]:(?:[\\/]|%5c)/i.test(src)) {
    throw new Error(`${where}: the image '${src}' is an absolute path on this computer. Give the path relative to slides.md, such as images/x.png.`)
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
    throw new Error(
      `${where}: the image '${src}' is a web address. The lecture file must work offline, ` +
        `so save the image into the lecture folder (for example images/) and link to it there.`,
    )
  }
  if (/\\|%5c/i.test(src)) {
    throw new Error(`${where}: the image '${src}' contains a backslash. Use / in image paths, such as images/x.png.`)
  }
  if (src.startsWith('/')) {
    throw new Error(`${where}: the image '${src}' starts with '/'. Give the path relative to slides.md, such as images/x.png.`)
  }

  const lectureDir = dirname(slidesPath)
  const assetsDir = join(courseRoot, 'assets')
  // markdown-it percent-encodes the path (a space becomes %20): try both spellings
  const spellings = [src]
  try {
    const decoded = decodeURI(src)
    if (decoded !== src) spellings.push(decoded)
  } catch {
    // not valid percent-encoding: the path is literal
  }
  const paths = spellings.map((s) => resolve(lectureDir, s.split(/[?#]/)[0]))

  let file: string | null = null
  let wrongCase: string | null = null
  for (const path of paths) {
    const root = isInside(lectureDir, path) ? lectureDir : isInside(assetsDir, path) ? assetsDir : null
    if (!root) {
      throw new Error(
        `${where}: the image '${src}' is outside the lecture folder. Copy it into the lecture folder ` +
          `(for example images/), or into the course's assets/ folder if several lectures use it.`,
      )
    }
    // walk each level with the exact names on disk, so letter case is checked
    // the same way here as on the Linux build
    let dir = root
    let found = true
    for (const part of relative(root, path).split(sep)) {
      const names = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : []
      if (!names.includes(part)) {
        wrongCase ??= names.find((n) => n.toLowerCase() === part.toLowerCase()) ?? null
        found = false
        break
      }
      dir = join(dir, part)
    }
    if (found && statSync(dir).isFile()) {
      file = dir
      break
    }
  }
  if (!file && wrongCase) {
    throw new Error(
      `${where}: the image '${src}' has the wrong capital letters: on disk the name is '${wrongCase}'. ` +
        `Letter case must match, because the course is built on Linux. Fix the path in slides.md, ` +
        `or rename the file with git mv (renaming only the case in Explorer is invisible to git).`,
    )
  }
  if (!file) {
    onMissing?.(paths)
    throw new Error(`${where}: the image '${src}' was not found (looked for ${paths[0]}).`)
  }
  if (!IMAGE_TYPES[extname(file).toLowerCase()]) {
    throw new Error(
      `${where}: '${src}' is not a supported image type. Use one of: ${Object.keys(IMAGE_TYPES).join(', ')}.`,
    )
  }
  return file
}

function dataUri(file: string): string {
  return `data:${IMAGE_TYPES[extname(file).toLowerCase()]};base64,${readFileSync(file).toString('base64')}`
}

export function slidesPlugin({ courseRoot }: { courseRoot: string }): Plugin {
  // image path → the slides.md files that use it (or looked for it), so the
  // preview reloads when it is added, changed or removed
  const imageUsers = new Map<string, Set<string>>()
  let server: ViteDevServer | undefined

  const track = (file: string, id: string) => {
    const key = normalizePath(file)
    if (!imageUsers.has(key)) imageUsers.set(key, new Set())
    imageUsers.get(key)!.add(id)
  }

  /** rebuild the slides that use this image and reload the preview; false if none do */
  const reloadUsers = (file: string): boolean => {
    const users = imageUsers.get(normalizePath(file))
    if (!users || !server) return false
    for (const id of users) {
      const mod = server.moduleGraph.getModuleById(id)
      if (mod) server.moduleGraph.invalidateModule(mod)
    }
    server.ws.send({ type: 'full-reload' })
    return true
  }

  return {
    name: 'lysark-slides',
    enforce: 'pre',

    configureServer(devServer) {
      server = devServer
      // Vite runs handleHotUpdate only for changed files, never for added or removed ones
      devServer.watcher.on('add', reloadUsers)
      devServer.watcher.on('unlink', reloadUsers)
    },

    transform(code, id) {
      if (!id.endsWith('.md')) return null
      const { slides, images } = compileLecture(code)
      const files: string[] = [] // one entry per distinct image file
      const fileOf = images.map((image) => {
        const file = resolveImage(image, id, courseRoot, (paths) => {
          // a missing image: watch the nearest folder that exists (inside the course),
          // so adding the image, or its folder, reloads the preview
          for (const path of paths) {
            track(path, id)
            let dir = dirname(path)
            while (!existsSync(dir) && dir.startsWith(courseRoot + sep)) dir = dirname(dir)
            if (server && (dir === courseRoot || dir.startsWith(courseRoot + sep))) server.watcher.add(dir)
          }
        })
        this.addWatchFile(file)
        track(file, id)
        const key = normalizePath(file)
        const k = files.indexOf(key)
        return k >= 0 ? k : files.push(key) - 1
      })
      // A placeholder is always a quoted attribute value inside a JSON string, so
      // close the string around it and add the file's constant: each image file
      // is stored once, however many slides use it.
      const json = JSON.stringify(slides).replace(
        new RegExp(`\\\\"${IMAGE_TOKEN}(\\d+)\\\\"`, 'g'),
        (_, n: string) => `\\"" + I${fileOf[Number(n)]} + "\\"`,
      )
      const consts = files.map((f, k) => `const I${k} = ${JSON.stringify(dataUri(f))}\n`).join('')
      return { code: `${consts}export default ${json}`, map: null }
    },

    handleHotUpdate({ file }) {
      if (reloadUsers(file)) return []
    },
  }
}
