import { normalizePath, type Plugin, type ViteDevServer } from 'vite'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { compileSlides } from './src/compiler/compile-slides'
import { SCENE_NAMES } from './src/scenes/registry'

/**
 * Turns a lecture folder into the deck the runtime imports (lysark-v2.md §3).
 *
 * A lecture folder holds no code, so this plugin generates its deck module in
 * memory: it reads the `scene:` names from `slides.md` and emits static imports
 * of just those engine scenes, plus the compiled slides. Static imports keep
 * the student file free of dynamic import() (lysark-design.md §9).
 *
 * In dev, `lecture` may be null: then `/` shows a list of the lectures in
 * `lecturesRoot`, and picking one switches the server to it.
 */
export interface LectureOptions {
  engineRoot: string
  lecturesRoot: string
  lecture: string | null
}

export const DECK_MODULE = 'virtual:lysark-deck'
const RESOLVED_DECK = '\0' + DECK_MODULE
const LIST_PATH = '/__lysark/lectures'
const OPEN_PATH = '/__lysark/open'

export interface LectureInfo {
  name: string
  dir: string
  title: string
}

export function listLectures(lecturesRoot: string): LectureInfo[] {
  if (!existsSync(lecturesRoot)) return []
  return readdirSync(lecturesRoot)
    .filter((name) => {
      const dir = join(lecturesRoot, name)
      return statSync(dir).isDirectory() && existsSync(join(dir, 'slides.md'))
    })
    .sort()
    .map((name) => {
      const dir = join(lecturesRoot, name)
      return { name, dir, title: lectureTitle(readFileSync(join(dir, 'slides.md'), 'utf8'), name) }
    })
}

/** the first `# ` heading in a slide body, skipping frontmatter and code fences */
export function lectureTitle(text: string, fallback: string): string {
  let inFrontmatter = false
  let inFence = false
  // a byte-order mark (Notepad's "UTF-8 with BOM") would hide the first `---`
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^(```|~~~)/.test(line.trimStart())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^---\s*$/.test(line)) {
      inFrontmatter = !inFrontmatter
      continue
    }
    const heading = !inFrontmatter && /^#\s+(.+)$/.exec(line)
    if (heading) return heading[1].replace(/[*_`$]/g, '').trim()
  }
  return fallback
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function deckModuleCode(engineRoot: string, lectureDir: string): string {
  const slidesPath = join(lectureDir, 'slides.md')
  const slides = compileSlides(readFileSync(slidesPath, 'utf8'))
  const known = new Set<string>(SCENE_NAMES)
  const used: string[] = []
  for (const slide of slides) {
    if (!slide.scene || used.includes(slide.scene)) continue
    if (!known.has(slide.scene)) {
      throw new Error(
        `${basename(lectureDir)}: slide '${slide.id}' uses unknown scene '${slide.scene}'. ` +
          `Available scenes: ${SCENE_NAMES.join(', ')}.`,
      )
    }
    used.push(slide.scene)
  }
  const engine = (rel: string) => JSON.stringify(normalizePath(join(engineRoot, rel)))
  const imports = used.map((name, i) => `import scene${i} from ${engine(`src/scenes/${name}.ts`)}`)
  const entries = used.map((name, i) => `${JSON.stringify(name)}: scene${i}`)
  return [
    `import { defineDeck } from ${engine('src/engine/deck.ts')}`,
    ...imports,
    `import slides from ${JSON.stringify(normalizePath(slidesPath))}`,
    `export default defineDeck({ scenes: { ${entries.join(', ')} }, slides })`,
  ].join('\n')
}

function listPage(lectures: LectureInfo[], lecturesRoot: string): string {
  const items = lectures.length
    ? lectures
        .map(
          (l) =>
            `<li><a href="${OPEN_PATH}?name=${encodeURIComponent(l.name)}">${escapeHtml(l.title)}</a>` +
            ` <span>${escapeHtml(l.name)}</span></li>`,
        )
        .join('\n')
    : `<li>No lectures found. A lecture is a folder with a <code>slides.md</code> in
       <code>${escapeHtml(lecturesRoot)}</code>.</li>`
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Lysark lectures</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  ul { list-style: none; padding: 0; }
  li { margin: 0.6rem 0; }
  a { font-size: 1.15rem; }
  span { opacity: 0.6; margin-left: 0.5rem; font-size: 0.9rem; }
</style></head>
<body><h1>Pick a lecture</h1><ul>
${items}
</ul></body></html>`
}

export function lecturePlugin(opts: LectureOptions): Plugin {
  let current = opts.lecture
  let server: ViteDevServer | undefined

  const invalidateDeck = () => {
    const mod = server?.moduleGraph.getModuleById(RESOLVED_DECK)
    if (mod) server!.moduleGraph.invalidateModule(mod)
  }

  return {
    name: 'lysark-lecture',

    resolveId(id) {
      return id === DECK_MODULE ? RESOLVED_DECK : null
    },

    load(id) {
      if (id !== RESOLVED_DECK) return null
      if (!current) {
        throw new Error('No lecture selected. Run `lysark dev <lecture>` or pick one from the list.')
      }
      // watch slides.md before compiling it: a lecture outside Vite's root is
      // otherwise only watched once it has compiled successfully
      this.addWatchFile(normalizePath(join(current, 'slides.md')))
      return deckModuleCode(opts.engineRoot, current)
    },

    transformIndexHtml(html) {
      if (!current) return html
      const title = lectureTitle(readFileSync(join(current, 'slides.md'), 'utf8'), basename(current))
      // a replacer function, so `$` in a title is never read as a replace() pattern
      return html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    },

    // the scene list in the generated deck module comes from slides.md, so an
    // edit there must re-run load(). If the deck failed to load, it never
    // imported slides.md and Vite has nothing to propagate: reload explicitly.
    handleHotUpdate({ file, modules, server: devServer }) {
      if (!current || normalizePath(file) !== normalizePath(join(current, 'slides.md'))) return
      invalidateDeck()
      if (modules.length === 0) devServer.ws.send({ type: 'full-reload' })
    },

    configureServer(devServer) {
      server = devServer
      devServer.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === LIST_PATH || (!current && (url.pathname === '/' || url.pathname === '/index.html'))) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(listPage(listLectures(opts.lecturesRoot), opts.lecturesRoot))
          return
        }
        if (url.pathname === OPEN_PATH) {
          const name = url.searchParams.get('name') ?? ''
          const lecture = listLectures(opts.lecturesRoot).find((l) => l.name === name)
          if (!lecture) {
            res.statusCode = 404
            res.end(`No lecture named '${name}'`)
            return
          }
          current = lecture.dir
          invalidateDeck()
          res.statusCode = 302
          res.setHeader('Location', '/')
          res.end()
          return
        }
        next()
      })
    },
  }
}
