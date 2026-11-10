import { normalizePath, type Plugin, type ViteDevServer } from 'vite'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { compileLecture, IMAGE_TOKEN, type ImageRef, type ModelRef } from './src/compiler/compile-slides'
import { IMAGE_TYPES } from './src/compiler/image-types'
import { modelSizeProblem, modelWhere } from './src/compiler/model-types'
import { checkModel } from './src/scene/model-check'

/**
 * Compiles a lecture's slides.md to slide objects at build time (spec §8),
 * and builds its images into the result (lysark-v2.md step 2): the compiler
 * reports the images, this plugin reads them and inlines each file once, as a
 * data URI, so the student file needs nothing next to it. The browser imports
 * plain data; markdown-it/yaml/katex never ship.
 *
 * The model files its scene files show go the same way (docs/scene-files.md,
 * "Models"): each is found as an image is, checked as the editor panel checks
 * it (src/scene/model-check.ts), and inlined once, as base64, in the module's
 * `models` export, which the deck's model loader parses (vite-plugin-lecture.ts).
 */

/** true when file is somewhere under dir (Windows paths compare without case) */
function isInside(dir: string, file: string): boolean {
  const r = relative(dir.toLowerCase(), file.toLowerCase())
  return r !== '' && !isAbsolute(r) && r.split(/[\\/]/)[0] !== '..'
}

/** true when file is dir or somewhere under it (compared without case, as isInside) */
function isAtOrInside(dir: string, file: string): boolean {
  return relative(dir.toLowerCase(), file.toLowerCase()) === '' || isInside(dir, file)
}

/** the names in a folder, as on disk; none if it isn't a folder or can't be read */
function namesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * A path's segments as path.resolve reads its text: without '' and '.', and
 * with each 'name/..' taken out, so only leading '..' are left.
 */
function segmentsOf(path: string): string[] {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  return out
}

/** the files a lecture builds in, each named by a path from the lecture folder */
export type FileKind = 'image' | 'model'

/**
 * How resolveFile reads each kind's path, and what it says when the file
 * can't be used. `fix` is how to write a model path that was written from
 * scenes/ (writtenFromScenes). A kind with a `link` message refuses a path
 * through a link.
 */
const FILE_KINDS: Record<
  FileKind,
  {
    spellings(src: string): string[]
    outside(src: string, fix?: string): string
    wrongCase(src: string, onDisk: string): string
    wrongFolder(src: string, onDisk: string): string
    link?(src: string, link: string): string
    notFound(src: string, looked: string, fix?: string): string
  }
> = {
  image: {
    spellings(src) {
      // markdown-it percent-encodes the path (a space becomes %20): try both spellings
      const spellings = [src]
      try {
        const decoded = decodeURI(src)
        if (decoded !== src) spellings.push(decoded)
      } catch {
        // not valid percent-encoding: the path is literal
      }
      return spellings.map((s) => s.split(/[?#]/)[0])
    },
    outside: (src) =>
      `the image '${src}' is outside the lecture folder. Copy it into the lecture folder ` +
      `(for example images/), or into the course's assets/ folder if several lectures use it.`,
    wrongCase: (src, onDisk) =>
      `the image '${src}' has the wrong capital letters: on disk the name is '${onDisk}'. ` +
      `Letter case must match, because the course is built on Linux. Fix the path in slides.md, ` +
      `or rename '${onDisk}' with git mv (renaming only the case in Explorer is invisible to git).`,
    wrongFolder: (src, onDisk) =>
      `the image '${src}' is in the course's assets folder, which on disk is named '${onDisk}'. It must be named 'assets', ` +
      `because the course is built on Linux. Rename the folder with git mv (renaming only the case in Explorer is invisible to git).`,
    notFound: (src, looked) => `the image '${src}' was not found (looked for ${looked}).`,
  },
  model: {
    // a scene file's path is plain text, taken as written (docs/scene-files.md, "Models")
    spellings: (src) => [src],
    outside: (src, fix) =>
      fix
        ? `the model '${src}' is outside the lecture folder. Write ${fix}: the path is from the lecture folder, not from scenes/`
        : `the model '${src}' is outside the lecture folder. Put it in the lecture folder (for example models/), ` +
          `or in the course's assets/ folder if several lectures use it`,
    wrongCase: (src, onDisk) =>
      `the model '${src}' has the wrong capital letters: on disk the name is '${onDisk}'. ` +
      `Letter case must match, because the course is built on Linux. Fix the path in the scene file, ` +
      `or rename '${onDisk}' with git mv (renaming only the case in Explorer is invisible to git)`,
    wrongFolder: (src, onDisk) =>
      `the model '${src}' is in the course's assets folder, which on disk is named '${onDisk}'. It must be named 'assets', ` +
      `because the course is built on Linux. Rename the folder with git mv (renaming only the case in Explorer is invisible to git)`,
    // extension 0.3.0's host reads no file through a link in the lecture folder or assets/
    link: (src, link) => `the model '${src}' goes through a link ('${link}'), which VS Code's panel won't read: copy the file into place`,
    notFound: (src, looked, fix) =>
      `the model '${src}' was not found (looked for ${looked}). ` +
      `Paths in scene files are from the lecture folder, where slides.md is, as for images` +
      (fix ? `. Write ${fix}: the path is from the lecture folder, not from scenes/` : ''),
  },
}

/**
 * How to write `src` from the lecture folder when it was written from the
 * scene file's own folder: read from scenes/, it names a file that is there,
 * in the lecture folder or assets/. Undefined when it doesn't, so a path that
 * is simply wrong gets no misleading advice.
 */
function writtenFromScenes(src: string, lectureDir: string, assetsDir: string): string | undefined {
  const path = resolve(lectureDir, 'scenes', src)
  if (!isInside(lectureDir, path) && !isInside(assetsDir, path)) return undefined
  if (!existsSync(path) || !statSync(path).isFile()) return undefined
  return relative(lectureDir, path).split(sep).join('/')
}

/**
 * The file a lecture's path names: an image's src in slides.md, or a model
 * in a scene file. Paths are from the lecture folder (where slides.md is),
 * and the file must be inside it or the course's assets/ folder: the
 * published site only rebuilds a lecture when those change (scripts/site.mjs),
 * so the course's folder must be named exactly `assets`. Letter case must
 * match all along the path as written, because the course is built on Linux.
 * A model's path must not go through a link there, which VS Code's panel
 * won't read. `where` starts each error message. onMissing gets the paths
 * where a file that can't be used was looked for, and the same paths spelled
 * as on disk when only letter case is wrong, so renaming the file is seen too.
 */
export function resolveFile(
  kind: FileKind,
  src: string,
  where: string,
  lectureDir: string,
  courseRoot: string,
  onMissing?: (paths: string[]) => void,
): string {
  const words = FILE_KINDS[kind]
  const assetsDir = join(courseRoot, 'assets')
  const spellings = words.spellings(src)
  const paths = spellings.map((s) => resolve(lectureDir, s))
  // only a scene file's path can have been written from scenes/
  const fix = () => (kind === 'model' ? writtenFromScenes(src, lectureDir, assetsDir) : undefined)

  let wrongFolder: string | null = null // the name on disk of the course's assets folder, in other letter case
  let wrongCase: string | null = null // the name on disk of a folder or file the path writes in other letter case
  let link: string | null = null // the path, as written, to a link it goes through
  const onDisk: string[] = [] // a path in the wrong letter case, spelled as on disk
  for (const [k, path] of paths.entries()) {
    const root = isInside(lectureDir, path) ? lectureDir : isInside(assetsDir, path) ? assetsDir : null
    if (!root) throw new Error(`${where}: ${words.outside(src, fix())}`)
    // follow the path as written from the lecture folder, each name exactly as
    // on disk, so letter case is checked all along it as on the Linux build:
    // `../Demo/models/` from the lecture folder `demo` too
    const parts = segmentsOf(spellings[k])
    let dir = lectureDir
    let found = true
    for (const [i, part] of parts.entries()) {
      if (part === '..') {
        dir = dirname(dir)
        continue
      }
      const names = namesIn(dir)
      if (!names.includes(part)) {
        const name = names.find((n) => n.toLowerCase() === part.toLowerCase())
        if (name) {
          wrongCase ??= name
          onDisk.push(join(dir, name, ...parts.slice(i + 1)))
        }
        found = false
        break
      }
      dir = join(dir, part)
      // the panel's host checks for links below the lecture folder, and from
      // the course folder down for assets/: the lecture folder itself, and
      // the folders above it, are never checked
      if (words.link && (isInside(lectureDir, dir) || isAtOrInside(assetsDir, dir)) && lstatSync(dir).isSymbolicLink()) {
        link ??= parts.slice(0, i + 1).join('/')
        found = false
        break
      }
    }
    // the course's folder by its exact name too: the published site rebuilds a
    // lecture when the folder named `assets` changes (scripts/site.mjs)
    if (root === assetsDir) {
      const names = namesIn(courseRoot)
      const name = names.includes('assets') ? undefined : names.find((n) => n.toLowerCase() === 'assets')
      if (name) {
        wrongFolder ??= name
        if (found) onDisk.push(dir)
        continue
      }
    }
    // inside the root by the platform's own rule: on Linux, `../L1/` from the
    // lecture folder `l1` is another folder, which isInside doesn't tell apart
    if (found && relative(root, dir).split(sep)[0] !== '..' && statSync(dir, { throwIfNoEntry: false })?.isFile()) {
      return dir
    }
  }
  const problem = wrongFolder
    ? words.wrongFolder(src, wrongFolder)
    : wrongCase
      ? words.wrongCase(src, wrongCase)
      : link && words.link
        ? words.link(src, link)
        : words.notFound(src, paths[0], fix())
  // watched even where the file is there, so the fix the message asks for
  // (renaming it, or copying it in place of a link) reloads the preview
  onMissing?.([...paths, ...onDisk])
  throw new Error(`${where}: ${problem}`)
}

/**
 * The image file an <img src> names (resolveFile). Its path is checked
 * here, as the compiler leaves an image's src as written; a model's path the
 * compiler checks itself, with the scene file's line.
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
  const file = resolveFile('image', src, where, dirname(slidesPath), courseRoot, onMissing)
  if (!IMAGE_TYPES[extname(file).toLowerCase()]) {
    throw new Error(
      `${where}: '${src}' is not a supported image type. Use one of: ${Object.keys(IMAGE_TYPES).join(', ')}.`,
    )
  }
  return file
}

/**
 * The text of a lecture's scene files (`scenes/*.yaml` and `.yml`), by path
 * relative to the lecture folder, for the compiler, which never reads files
 * (docs/scene-files.md).
 */
export function lectureSceneFiles(lectureDir: string): Record<string, string> {
  // by its exact name, as on the Linux build: Windows would find `Scenes` too
  const names = existsSync(lectureDir) ? readdirSync(lectureDir) : []
  if (!names.includes('scenes')) {
    const wrong = names.find((n) => n.toLowerCase() === 'scenes')
    if (wrong) {
      throw new Error(
        `${basename(lectureDir)}: the scene folder is named '${wrong}'; it must be 'scenes', because the course is built ` +
          `on Linux. Rename it with git mv (renaming only the case in Explorer is invisible to git).`,
      )
    }
    return {}
  }
  const dir = join(lectureDir, 'scenes')
  if (!statSync(dir).isDirectory()) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name)
    // any letter case: the compiler reports a name it can't take
    if (/\.ya?ml$/i.test(name) && !name.startsWith('.') && statSync(file).isFile()) out[`scenes/${name}`] = readFileSync(file, 'utf8')
  }
  return out
}

function dataUri(file: string): string {
  return `data:${IMAGE_TYPES[extname(file).toLowerCase()]};base64,${readFileSync(file).toString('base64')}`
}

/**
 * The model files a lecture shows (compileLecture's `models`), each found
 * (resolveFile), checked (src/scene/model-check.ts) and read once, however
 * many objects show it: its bytes, and every path the scene files write for
 * it. Throws the first problem, after the scene file, line and object, as
 * the editor panel says it. `found` gets each file before it is checked, so
 * the preview reloads when a refused file is fixed.
 */
async function readModels(
  refs: ModelRef[],
  lectureDir: string,
  courseRoot: string,
  found: (file: string) => void,
  onMissing: (paths: string[]) => void,
): Promise<Array<{ base64: string; srcs: string[] }>> {
  // by file, in the order the scene files first show each
  const users = new Map<string, ModelRef[]>()
  for (const ref of refs) {
    const file = resolveFile('model', ref.src, modelWhere(ref), lectureDir, courseRoot, onMissing)
    found(file)
    if (!users.has(file)) users.set(file, [])
    users.get(file)!.push(ref)
  }
  const out: Array<{ base64: string; srcs: string[] }> = []
  for (const [file, uses] of users) {
    // the size on disk first, so a file far over the limit is never read
    const size = modelSizeProblem(statSync(file).size)
    if (size) throw new Error(`${modelWhere(uses[0])}: ${size}`)
    const bytes = readFileSync(file)
    // exactly the file's bytes: a small file's Buffer is a view into a shared
    // pool, whose whole ArrayBuffer would be read as a different file
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    // each object reads the file in its own unit: a problem names the first
    // object with the unit it is about, so a wrong unit points at its own line.
    // A second unit parses the file again, which only a file shown in two units costs.
    for (const unit of new Set(uses.map((ref) => ref.unit))) {
      const user = uses.find((ref) => ref.unit === unit)!
      const problem = await checkModel(buffer, user.format, [unit])
      if (problem) throw new Error(`${modelWhere(user)}: ${problem}`)
    }
    out.push({ base64: bytes.toString('base64'), srcs: [...new Set(uses.map((ref) => ref.src))] })
  }
  return out
}

export function slidesPlugin({ courseRoot }: { courseRoot: string }): Plugin {
  // image or model path (or a lecture's scenes/ folder, or scene file) → the
  // slides.md files that use it (or looked for it), so the preview reloads when
  // it is added, changed or removed
  const imageUsers = new Map<string, Set<string>>()
  let server: ViteDevServer | undefined

  const track = (file: string, id: string) => {
    const key = normalizePath(file)
    if (!imageUsers.has(key)) imageUsers.set(key, new Set())
    imageUsers.get(key)!.add(id)
  }

  /** rebuild the slides that use this file and reload the preview; false if none do */
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
      // Vite runs handleHotUpdate only for changed files, never for added or
      // removed ones; a scene file added or removed counts for its folder
      const added = (file: string) => {
        if (!reloadUsers(file)) reloadUsers(dirname(file))
      }
      devServer.watcher.on('add', added)
      devServer.watcher.on('unlink', added)
    },

    async transform(code, id) {
      if (!id.endsWith('.md')) return null
      // the lecture's scene files: a change to one, or one added, rebuilds the slides
      const lectureDir = dirname(id)
      const sceneFiles = lectureSceneFiles(lectureDir)
      for (const path of Object.keys(sceneFiles)) {
        this.addWatchFile(join(lectureDir, path))
        track(join(lectureDir, path), id)
      }
      track(join(lectureDir, 'scenes'), id)
      if (server) server.watcher.add(existsSync(join(lectureDir, 'scenes')) ? join(lectureDir, 'scenes') : lectureDir)
      const { slides, images, models } = compileLecture(code, sceneFiles)
      // an image or model file the lecture uses: changing it rebuilds the slides
      const watch = (file: string) => {
        this.addWatchFile(file)
        track(file, id)
      }
      // a file that can't be used (missing, in other letter case, or through a
      // link): track each path and watch the nearest folder that exists (inside
      // the course), so adding or renaming the file, or its folder, reloads the
      // preview. A path that exists is tracked, and its own folder watched.
      const watchMissing = (paths: string[]) => {
        for (const path of paths) {
          track(path, id)
          let dir = dirname(path)
          while (!existsSync(dir) && dir.startsWith(courseRoot + sep)) dir = dirname(dir)
          if (server && (dir === courseRoot || dir.startsWith(courseRoot + sep))) server.watcher.add(dir)
        }
      }
      const files: string[] = [] // one entry per distinct image file
      const fileOf = images.map((image) => {
        const file = resolveImage(image, id, courseRoot, watchMissing)
        watch(file)
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
      // each model file once too, by every path the scene files write for it; always
      // exported, {} without models, so the deck module can import it whenever it needs
      const modelFiles = await readModels(models, lectureDir, courseRoot, watch, watchMissing)
      const modelConsts = modelFiles.map(({ base64 }, k) => `const M${k} = ${JSON.stringify(base64)}\n`).join('')
      const modelEntries = modelFiles.flatMap(({ srcs }, k) => srcs.map((src) => `${JSON.stringify(src)}: M${k}`))
      return {
        code: `${consts}${modelConsts}export const models = {${modelEntries.join(', ')}}\nexport default ${json}`,
        map: null,
      }
    },

    handleHotUpdate({ file }) {
      if (reloadUsers(file)) return []
    },
  }
}
