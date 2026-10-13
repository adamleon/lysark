// Course CI (lysark-v2.md §6, step 1): publish every lecture's student file
// and PDF to GitHub Pages, rebuilding only what changed.
//
// `site` runs first: it reads which version of each lecture the live site
// holds (versions.json), copies unchanged lectures from the live site, and
// builds and offline-checks the rest. A lecture that fails keeps its previous
// version. `site-pdf` then makes the PDFs for the lectures `site` rebuilt, so
// the slow PDF never delays a fix. `site-status` fails the run if anything
// failed, after the site is published.
//
// A lecture's version is a hash of its folder, `assets/`, and
// `package-lock.json` (which records the engine version), as committed.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { buildLecture, lecturesIn } from './lectures.mjs'

const STATE_FILE = 'lysark-state.json'
// marks an output folder as site's own while a run is writing it, so a run that
// stopped halfway doesn't make the next one refuse the folder
const IN_PROGRESS = '.lysark-site-in-progress'

function gitObject(courseRoot, path) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], {
      cwd: courseRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'none'
  }
}

export function lectureVersion(courseRoot, name) {
  const parts = [`lectures/${name}`, 'assets', 'package-lock.json'].map((p) => gitObject(courseRoot, p))
  if (parts[0] === 'none') {
    throw new Error(`lectures/${name} is not committed; lysark site builds what is committed`)
  }
  return createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 16)
}

async function download(url, dest) {
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    return true
  } catch {
    return false
  }
}

function liveUrl(live, file) {
  const base = live.endsWith('/') ? live : `${live}/`
  // a fresh URL every run, so no cache can hand back an older copy
  return `${new URL(file, base).href}?t=${Date.now()}`
}

function htmlTitle(file, fallback) {
  const m = /<title>([^<]*)<\/title>/.exec(readFileSync(file, 'utf8'))
  // the build escapes & < > " ' as &#NN;; store the plain title, writeIndex escapes it once
  return m ? m[1].trim().replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))) : fallback
}

/** true in CI when a newer commit is already on the branch being published */
function superseded(courseRoot) {
  const { GITHUB_SHA: sha, GITHUB_REF: ref } = process.env
  if (!sha || !ref) return false
  try {
    const head = execFileSync('git', ['ls-remote', 'origin', ref], {
      cwd: courseRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\t')[0]
      .trim()
    return head !== '' && head !== sha
  } catch {
    return false
  }
}

/** error text for logs and annotations, without terminal colour codes */
function errorText(err) {
  return String(err?.message ?? err).replace(/\u001b\[[0-9;]*m/g, '')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function courseTitle(courseRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(courseRoot, 'package.json'), 'utf8'))
    return pkg.description || pkg.name || 'Lectures'
  } catch {
    return 'Lectures'
  }
}

function writeIndex(out, title, manifest) {
  const items = Object.entries(manifest.lectures)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, l]) => {
      const html = `${encodeURIComponent(name)}.html`
      const pdf = existsSync(join(out, `${name}.pdf`))
        ? `<a href="${encodeURIComponent(name)}.pdf">PDF</a>`
        : '<span class="muted">PDF coming</span>'
      return `<li><span class="title">${escapeHtml(l.title)}</span>
  <span class="links"><a href="${html}">Open</a> <a href="${html}" download="${escapeHtml(name)}.html">Download</a> ${pdf}</span></li>`
    })
    .join('\n')
  writeFileSync(
    join(out, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  ul { list-style: none; padding: 0; }
  li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
       padding: 0.8rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .title { font-size: 1.15rem; }
  .links a, .links span { margin-left: 1rem; }
  .muted { opacity: 0.55; }
  footer { margin-top: 2rem; opacity: 0.7; font-size: 0.9rem; }
</style></head>
<body><h1>${escapeHtml(title)}</h1>
<ul>
${items}
</ul>
<footer>Open a lecture to view it in the browser. Download saves the same file to open
offline later; it needs no internet connection. The PDF is for reading on a phone and for
printing.</footer>
</body></html>
`,
  )
}

function readState(courseRoot) {
  const file = join(courseRoot, STATE_FILE)
  if (!existsSync(file)) throw new Error(`${STATE_FILE} not found; run 'lysark site' first`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeState(courseRoot, state) {
  writeFileSync(join(courseRoot, STATE_FILE), JSON.stringify(state, null, 2))
}

/** the live site's versions.json; only a 404 means "nothing published yet" */
async function readLiveManifest(live) {
  let res
  try {
    res = await fetch(liveUrl(live, 'versions.json'))
  } catch (err) {
    throw new Error(`Could not reach the live site (${err.message}); nothing published, so no lecture is lost`)
  }
  if (res.status === 404) {
    console.log('No versions.json on the live site (404): first publish, building every lecture.')
    return { lectures: {} }
  }
  if (!res.ok) {
    throw new Error(`Could not read versions.json from the live site (HTTP ${res.status}); nothing published`)
  }
  const manifest = await res.json() // a body that isn't JSON throws, so nothing is published
  if (!manifest || typeof manifest.lectures !== 'object') {
    throw new Error('versions.json on the live site is malformed; nothing published')
  }
  return manifest
}

/** `out` is emptied, so it must be a folder inside the course that site made or that is empty */
function checkOutDir(courseRoot, out) {
  const rel = relative(courseRoot, out)
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..') {
    throw new Error(`--out must be a folder inside the course, such as _site (got ${out})`)
  }
  const madeBySite = existsSync(join(out, 'versions.json')) || existsSync(join(out, IN_PROGRESS))
  if (existsSync(out) && readdirSync(out).length > 0 && !madeBySite) {
    throw new Error(`${out} is not empty and was not made by 'lysark site'; remove it or pick another --out`)
  }
}

export async function site({ courseRoot, out, live, checkOffline }) {
  out = resolve(courseRoot, out)
  checkOutDir(courseRoot, out)
  const lectures = lecturesIn(courseRoot)
  const liveManifest = live ? await readLiveManifest(live) : { lectures: {} }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, IN_PROGRESS), '')
  const manifest = { lectures: {} }
  // relative, so the PDF job can use the state from another checkout
  const state = { out: relative(courseRoot, out), pdfTodo: [], failed: [], summary: [] }

  /** copy a lecture's live HTML (and PDF, if it has one) into out; false if any download fails */
  const restorePrevious = async (name, prev) => {
    if (!prev || !live) return false
    if (!(await download(liveUrl(live, `${name}.html`), join(out, `${name}.html`)))) return false
    if (prev.pdf && !(await download(liveUrl(live, `${name}.pdf`), join(out, `${name}.pdf`)))) return false
    manifest.lectures[name] = { title: prev.title, html: prev.html, pdf: prev.pdf ?? null }
    return true
  }

  for (const lecture of lectures) {
    const { name } = lecture
    const version = lectureVersion(courseRoot, name)
    const prev = liveManifest.lectures?.[name]

    if (prev && prev.html === version && (await restorePrevious(name, prev))) {
      if (manifest.lectures[name].pdf !== version) state.pdfTodo.push(name)
      state.summary.push(`= ${name}: unchanged`)
      continue
    }

    const htmlFile = join(out, `${name}.html`)
    try {
      console.log(`\n── building ${name}`)
      await buildLecture(lecture, htmlFile, { quiet: true })
      const report = await checkOffline(htmlFile)
      for (const line of report.lines) console.log(`   ${line}`)
      if (!report.ok) {
        // lead with the actual problem, so the run's annotation names it
        const problem =
          report.lines.find((l) => /^\s*(deck did not start|pageerror|console\.error|request):?/.test(l)) ??
          report.lines[0]
        throw new Error(`offline check failed: ${problem.trim()}\n${report.lines.join('\n')}`)
      }
      // keep the previous PDF until site-pdf replaces it
      let pdf = null
      if (prev?.pdf && live && (await download(liveUrl(live, `${name}.pdf`), join(out, `${name}.pdf`)))) {
        pdf = prev.pdf
      }
      manifest.lectures[name] = { title: htmlTitle(htmlFile, name), html: version, pdf }
      state.pdfTodo.push(name)
      state.summary.push(`+ ${name}: rebuilt`)
    } catch (err) {
      rmSync(htmlFile, { force: true })
      rmSync(join(out, `${name}.pdf`), { force: true })
      state.failed.push({ name, stage: 'html', message: errorText(err) })
      console.log(`   ${errorText(err)}`)
      const kept = await restorePrevious(name, prev)
      if (prev && !kept) {
        // publishing without it would take a live lecture down
        throw new Error(`${name} failed, and its previous version could not be copied from the live site; nothing published`)
      }
      state.summary.push(`! ${name}: FAILED, ${kept ? 'kept the previous version' : 'not published (never was)'}`)
    }
  }

  writeFileSync(join(out, 'versions.json'), JSON.stringify(manifest, null, 2))
  writeIndex(out, courseTitle(courseRoot), manifest)
  writeState(courseRoot, { ...state, manifest })
  rmSync(join(out, IN_PROGRESS), { force: true })
  console.log(`\n${state.summary.join('\n')}`)
}

export async function sitePdf({ courseRoot, exportPdf }) {
  const state = readState(courseRoot)
  const { manifest } = state
  const out = resolve(courseRoot, state.out)
  for (const [i, name] of state.pdfTodo.entries()) {
    // PDFs are never urgent: give way to a newer commit's run. Skipped lectures
    // keep their old pdf version in versions.json, so that run makes them.
    if (superseded(courseRoot)) {
      state.summary.push(`- PDFs postponed, a newer commit is waiting: ${state.pdfTodo.slice(i).join(', ')}`)
      break
    }
    console.log(`── PDF for ${name}`)
    try {
      await exportPdf(join(out, `${name}.html`), join(out, `${name}.pdf`))
      manifest.lectures[name].pdf = manifest.lectures[name].html
      state.summary.push(`+ ${name}: PDF made`)
    } catch (err) {
      state.failed.push({ name, stage: 'pdf', message: errorText(err) })
      state.summary.push(`! ${name}: PDF FAILED, ${existsSync(join(out, `${name}.pdf`)) ? 'kept the previous PDF' : 'no PDF'}`)
      console.log(`   ${errorText(err)}`)
    }
  }
  state.pdfTodo = []
  writeFileSync(join(out, 'versions.json'), JSON.stringify(manifest, null, 2))
  writeIndex(out, courseTitle(courseRoot), manifest)
  writeState(courseRoot, { ...state, manifest })
  console.log(`\n${state.summary.join('\n')}`)
}

/** exit code 1 if any lecture failed, with a GitHub annotation per failure */
export function siteStatus({ courseRoot }) {
  const state = readState(courseRoot)
  for (const f of state.failed) {
    const first = f.message.split('\n')[0]
    console.log(`::error title=${f.name} (${f.stage})::${first}`)
  }
  console.log(state.summary.join('\n'))
  return state.failed.length === 0
}
