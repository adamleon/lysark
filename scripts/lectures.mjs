// Finding lecture folders and building a lecture's student file. Plain
// JavaScript: Node won't run TypeScript from inside node_modules, so the
// TypeScript parts (compiler, Vite plugins) are reached through Vite, which
// compiles vite.config.ts and what it imports (lysark-v2.md §3).
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(ENGINE_ROOT, 'vite.config.ts')

/**
 * @typedef {{ name: string, dir: string, lecturesRoot: string, courseRoot: string }} Lecture
 */

/** lecture folders (folders with a slides.md) under <courseRoot>/lectures, sorted */
export function lecturesIn(courseRoot) {
  const lecturesRoot = join(courseRoot, 'lectures')
  if (!existsSync(lecturesRoot)) return []
  return readdirSync(lecturesRoot)
    .filter((name) => {
      const dir = join(lecturesRoot, name)
      return statSync(dir).isDirectory() && existsSync(join(dir, 'slides.md'))
    })
    .sort()
    .map((name) => ({ name, dir: join(lecturesRoot, name), lecturesRoot, courseRoot }))
}

/**
 * A lecture given on the command line: a name (`baneplanlegging`, looked up in
 * ./lectures) or a path to a lecture folder (`../course/lectures/04-x`).
 * @returns {Lecture}
 */
export function resolveLecture(arg, cwd = process.cwd()) {
  const looksLikePath = /[\\/]/.test(arg) || arg.startsWith('.')
  const dir = looksLikePath ? resolve(cwd, arg) : resolve(cwd, 'lectures', arg)
  if (!existsSync(join(dir, 'slides.md'))) {
    const known = lecturesIn(cwd).map((l) => l.name)
    throw new Error(
      `No lecture at ${dir} (a lecture is a folder with a slides.md).` +
        (known.length ? `\nLectures here: ${known.join(', ')}` : ''),
    )
  }
  const lecturesRoot = dirname(dir)
  return { name: basename(dir), dir, lecturesRoot, courseRoot: dirname(lecturesRoot) }
}

/** vite.config.ts reads these; they must be set before Vite loads the config */
export function selectLecture({ lecturesRoot, courseRoot, dir }) {
  process.env.LYSARK_LECTURES_ROOT = lecturesRoot
  process.env.LYSARK_COURSE_ROOT = courseRoot
  if (dir) process.env.LYSARK_LECTURE = dir
  else delete process.env.LYSARK_LECTURE
}

/** build one lecture's self-contained student file to outFile */
export async function buildLecture(lecture, outFile, { quiet = false } = {}) {
  selectLecture(lecture)
  const { build } = await import('vite')
  const tmp = mkdtempSync(join(tmpdir(), 'lysark-'))
  try {
    await build({
      configFile: CONFIG_FILE,
      logLevel: quiet ? 'warn' : 'info',
      build: { outDir: tmp, emptyOutDir: true },
    })
    mkdirSync(dirname(resolve(outFile)), { recursive: true })
    copyFileSync(join(tmp, 'index.html'), outFile)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * build the editor runtime (lysark-v2.md §5, step 3) into outDir as an
 * ordinary multi-file site with index.html at its top. It holds every scene and
 * compiles lecture text in the browser, so it needs no lecture. outDir is
 * replaced only if it is missing, empty, or an earlier editor build.
 */
export async function buildEditor(outDir, { quiet = false } = {}) {
  outDir = resolve(outDir)
  if (existsSync(outDir) && !readdirSync(outDir).every((name) => name === 'index.html' || name === 'assets')) {
    throw new Error(`${outDir} is not empty and is not an earlier editor build; remove it or pick another folder`)
  }
  selectLecture({ lecturesRoot: join(ENGINE_ROOT, 'lectures'), courseRoot: ENGINE_ROOT, dir: null })
  const { build } = await import('vite')
  const tmp = mkdtempSync(join(tmpdir(), 'lysark-editor-'))
  try {
    await build({
      configFile: CONFIG_FILE,
      mode: 'editor',
      logLevel: quiet ? 'warn' : 'info',
      build: { outDir: tmp, emptyOutDir: true },
    })
    renameSync(join(tmp, 'editor.html'), join(tmp, 'index.html'))
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(dirname(outDir), { recursive: true })
    cpSync(tmp, outDir, { recursive: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** start the dev server; lecture null shows a list to pick from */
export async function devServer({ lecturesRoot, courseRoot, lecture }) {
  selectLecture({ lecturesRoot, courseRoot, dir: lecture?.dir ?? null })
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: CONFIG_FILE })
  await server.listen()
  server.printUrls()
  server.bindCLIShortcuts({ print: true })
  return server
}
