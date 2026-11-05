// Boot check for the editor runtime (lysark-v2.md §5, step 3), inside a
// stand-in for the Lysark panel in vscode.dev / github.dev:
//
// - the runtime is served the way GitHub Pages serves a course site
//   (scripts/editor-server.mjs: `Access-Control-Allow-Origin: *`, nothing else);
// - the panel is built the way VS Code for the web builds a webview
//   (workbench/contrib/webview/browser/pre/index.html): a cross-origin-isolated
//   host page (COOP same-origin, COEP require-corp) loads `fake.html` in a
//   sandboxed frame, writes the panel page (src/editor/panel-page.js) into it
//   with document.write after adding VS Code's API script (which sets
//   window.parent to the page itself) and default styles, swaps the new frame
//   in on load or after 200 ms, and drops messages sent while it swaps;
// - the check plays the extension (messages version 3, docs/editor-host.md):
//   it sends texts, loads the page afresh when a text is accepted, answers the
//   panel's reads and edits on copies of slides.md and the lecture's scene
//   files with version numbers, and asks for saved views, by V and through
//   Scene Actions, on a slide with its own camera and on one that names a view.
//
// It requires: the lecture shown in an isolated panel with its images, VS
// Code's default styles gone, a view computed on an older version refused, a
// saved view written as one edit to the first slide's frontmatter and put into
// the running deck, a camera-only change put in place, a named view saved into
// its scene file and taken by the other slide that names it, Shift+V's
// dialog saving a new view in a new scene file, a new text
// accepted and shown after a reload, a broken text
// refused, script in lecture text never run (inline handler, javascript: links,
// a form), no errors, and no requests anywhere else. Engine CI runs it on the
// course-style build in Chromium and Firefox.
//
//   node scripts/check-editor.mjs <editor dir> <slides.md> [--browser firefox] [--screenshot file.png] [--headed]
import { createServer } from 'node:http'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './browser.mjs'
import { EDITOR_PREFIX, serveEditor, stopServer } from './editor-server.mjs'
import { EDITOR_PROTOCOL, editorAssets, editorProtocol, panelPage } from '../src/editor/panel-page.js'

const ISOLATED = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }

// VS Code's pre/fake.html: an empty page the panel's HTML is written into
const FAKE_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Fake</title></head><body></body></html>'

const HOST_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; img-src data:">
<link rel="icon" href="data:,">
</head><body style="margin:0;overflow:hidden;width:100%;height:100vh"><script src="host.js"></script></body></html>`

// the webview host's mechanics, abridged from pre/index.html
const HOST_JS = `
window.__toExtension = []
window.__vscode_post_message__ = (command, data) => {
  if (command !== 'onmessage') return
  const message = data.message
  window.__toExtension.push(message)
  // the extension's host requests (messages version 3), answered by the check
  if (/^lysark:(read|list|edit|ask)$/.test(message?.type)) window.__hostRequest(message).then((reply) => window.postToWebview(reply))
}
const API_SCRIPT = \`
  globalThis.acquireVsCodeApi = (function () {
    const originalPostMessage = window.parent.__vscode_post_message__.bind(window.parent)
    let acquired = false
    return () => {
      if (acquired) throw new Error('An instance of the VS Code API has already been acquired')
      acquired = true
      return Object.freeze({ postMessage(message) { originalPostMessage('onmessage', { message }) }, setState(s) { return s }, getState() {} })
    }
  })()
  window.parent = window;
  window.top = window;
  window.frameElement = null;\`
function toContentHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const api = doc.createElement('script')
  api.id = '_vscodeApiScript'
  api.textContent = API_SCRIPT
  doc.head.prepend(api)
  const styles = doc.createElement('style')
  styles.id = '_defaultStyles'
  styles.textContent = '@layer vscode-default { body { padding: 0 20px } code { padding: 1px 3px } img { max-width: 100%; max-height: 100% } }'
  doc.head.prepend(styles)
  return '<!DOCTYPE html>\\n' + doc.documentElement.outerHTML
}
let pendingMessages = []
let firstLoad = true
let loadTimeout
const pending = () => document.getElementById('pending-frame')
const active = () => document.getElementById('active-frame')
window.setHtml = (text) => {
  const html = toContentHtml(text)
  const previous = pending()
  if (previous) { previous.id = ''; previous.remove() }
  if (!firstLoad) pendingMessages = []
  firstLoad = false
  const frame = document.createElement('iframe')
  frame.id = 'pending-frame'
  // as the extension creates the panel: scripts on, forms off (enableForms: false)
  frame.setAttribute('sandbox', 'allow-same-origin allow-pointer-lock allow-scripts allow-downloads')
  frame.setAttribute('allow', 'cross-origin-isolated; autoplay;')
  frame.src = './fake.html?' + new URLSearchParams(crossOriginIsolated ? { id: '1', 'vscode-coi': '3' } : { id: '1' })
  frame.style.cssText = 'display:block;margin:0;position:absolute;width:100%;height:100%;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const swapIn = (contentDocument, contentWindow) => {
    if (pending() !== frame || frame.contentDocument !== contentDocument) return
    active()?.remove()
    frame.id = 'active-frame'
    frame.style.visibility = 'visible'
    for (const message of pendingMessages) contentWindow.postMessage(message, window.origin)
    pendingMessages = []
  }
  frame.contentWindow.addEventListener('DOMContentLoaded', (e) => {
    const contentDocument = e.target
    setTimeout(() => {
      contentDocument.open()
      contentDocument.write(html)
      contentDocument.close()
      clearTimeout(loadTimeout)
      loadTimeout = setTimeout(() => { loadTimeout = undefined; swapIn(frame.contentDocument, frame.contentWindow) }, 200)
      frame.contentWindow.addEventListener('load', function (e) {
        if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = undefined; swapIn(e.target, this) }
      })
    }, 0)
  })
}
window.postToWebview = (message) => {
  if (!pending() && active()) active().contentWindow.postMessage(message, window.origin)
  else pendingMessages.push(message)
}
`

// script that must never run in the panel
const SCRIPT_TEST = `---
id: script-test
---
# Script test

<details id="t1" open ontoggle="window.__ran = 'ontoggle'">x</details>
<a id="t2" href="javascript:window.__ran = 'javascript: link'">link</a>
<svg width="40" height="20"><a id="t3" href="javascript:window.__ran = 'svg javascript: link'"><text y="15">s</text></a></svg>
<form id="t4" action="/form-submitted"><button>go</button></form>
`

/**
 * The lecture with the camera offset of its first slide after the first that
 * has one of its own (a `camera:` block with `offset: [x, y, z]`) moved, as a
 * saved view would: only that value changes. null if no such slide.
 * @param {string} text
 * @returns {{ text: string, offset: number[], slide: number } | null}
 */
function moveSlideCamera(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let n = 1; ; n++) {
    const range = frontmatterLines(text, n)
    if (!range) return null
    let fm
    try {
      fm = parseYaml(lines.slice(range.from, range.to).join('\n'))
    } catch {
      continue
    }
    const old = fm?.camera?.offset
    if (!Array.isArray(old) || old.length !== 3 || !old.every(Number.isFinite)) continue
    // the `offset:` line inside the slide's `camera:` block (an anchored label has offsets too)
    const start = lines.findIndex((l, i) => i >= range.from && i < range.to && /^camera\s*:\s*(#.*)?$/.test(l))
    for (let i = start + 1; start >= 0 && i < range.to && /^\s/.test(lines[i]); i++) {
      const m = lines[i].match(/^(\s+offset:\s*)\[([^\]]*)\](.*)$/)
      if (!m) continue
      const offset = old.map((x, k) => Number((x + [0.4, 0.3, 0.4][k]).toFixed(2)))
      lines[i] = `${m[1]}[${offset.join(', ')}]${m[3]}`
      return { text: lines.join('\n'), offset, slide: n }
    }
  }
}

/**
 * The line range of slide `n`'s frontmatter (0-based slide, 0-based lines,
 * between its fences), or null. Fences inside code blocks don't count.
 * @param {string} text
 * @param {number} n
 * @returns {{ from: number, to: number } | null}
 */
function frontmatterLines(text, n) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const fences = []
  let inCode = false
  for (let i = 0; i < lines.length && fences.length < 2 * n + 2; i++) {
    if (/^(`{3,}|~{3,})/.test(lines[i].trimStart())) inCode = !inCode
    else if (!inCode && lines[i].trimEnd() === '---') fences.push(i)
  }
  return fences.length < 2 * n + 2 ? null : { from: fences[2 * n] + 1, to: fences[2 * n + 1] }
}

/**
 * The slides that name a camera view (`camera: <name>`), as { scene, view,
 * slides } for each view, in the order they first appear.
 * @param {string} text
 */
function namedViews(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const views = []
  for (let n = 0; ; n++) {
    const range = frontmatterLines(text, n)
    if (!range) return views
    let fm
    try {
      fm = parseYaml(lines.slice(range.from, range.to).join('\n'))
    } catch {
      continue
    }
    if (typeof fm?.camera !== 'string' || typeof fm.scene !== 'string') continue
    let entry = views.find((v) => v.scene === fm.scene && v.view === fm.camera)
    if (!entry) views.push((entry = { scene: fm.scene, view: fm.camera, slides: [] }))
    entry.slides.push(n)
  }
}

/**
 * The extension's side of messages version 3 (docs/editor-host.md), for the
 * check: slides.md and the lecture's scene files are documents with versions,
 * kept here; other files are read from the lecture folder.
 */
function createHost(lectureDir, lectureText) {
  /** path → { text, version }, as VS Code keeps open documents */
  const docs = new Map([['slides.md', { text: lectureText, version: 1 }]])
  const scenesDir = join(lectureDir, 'scenes')
  if (existsSync(scenesDir)) {
    for (const name of readdirSync(scenesDir).sort()) {
      if (/\.ya?ml$/.test(name)) docs.set(`scenes/${name}`, { text: readFileSync(join(scenesDir, name), 'utf8'), version: 1 })
    }
  }
  const host = {
    docs,
    get doc() {
      return docs.get('slides.md')
    },
    set doc(value) {
      docs.set('slides.md', value)
    },
    /** the files the extension sends: slides.md (or `slides`) and the scene files */
    files(slides = docs.get('slides.md').text) {
      return { ...Object.fromEntries([...docs].map(([path, d]) => [path, d.text])), 'slides.md': slides }
    },
    /** every edit request, with the reply it got */
    edits: [],
    /** image files read and found */
    served: 0,
    /** the next edit finds the document changed meanwhile (typing between read and edit) */
    typeBeforeNextEdit: false,
    /** paths asked for outside the lecture folder */
    outside: [],
  }
  const inside = (rel) => {
    const file = resolve(lectureDir, rel)
    if (!file.startsWith(lectureDir + sep)) {
      host.outside.push(rel)
      return null
    }
    return file
  }
  host.answer = (message) => {
    const reply = (body) => ({ type: 'lysark:reply', id: message.id, ...body })
    if (message.type === 'lysark:read') {
      const files = {}
      for (const rel of message.paths) {
        const file = inside(rel)
        if (docs.has(rel) && message.as === 'text') files[rel] = { ...docs.get(rel) }
        else if (!file || !existsSync(file)) files[rel] = { error: 'not found' }
        else if (message.as === 'bytes') {
          files[rel] = { base64: readFileSync(file).toString('base64') }
          host.served += 1
        } else files[rel] = { text: readFileSync(file, 'utf8'), version: 1 }
      }
      return reply({ files })
    }
    if (message.type === 'lysark:edit') {
      if (host.typeBeforeNextEdit) {
        host.typeBeforeNextEdit = false
        host.doc.version += 1
      }
      // as the extension does: every change checked first, then all applied
      let result = { ok: true }
      const changes = message.changes ?? []
      for (const change of changes) {
        const doc = docs.get(change.path)
        if (typeof change.create === 'string') {
          if (doc || !/^scenes\/[a-z][a-z0-9-]*\.yaml$/.test(change.path)) result = { ok: false, message: `can't create ${change.path}` }
        } else if (!doc) result = { ok: false, message: 'only slides.md and scene files here' }
        else if (change.version !== doc.version) result = { ok: false, message: `${change.path} changed meanwhile; try again` }
      }
      if (changes.length === 0) result = { ok: false, message: 'no changes' }
      if (result.ok) {
        for (const change of changes) {
          if (typeof change.create === 'string') docs.set(change.path, { text: change.create, version: 1 })
          else {
            const doc = docs.get(change.path)
            docs.set(change.path, { text: doc.text.slice(0, change.start) + change.text + doc.text.slice(change.end), version: doc.version + 1 })
          }
        }
      }
      host.edits.push({ message, result })
      return reply(result)
    }
    if (message.type === 'lysark:ask') {
      // the first choice offered, as if picked
      return reply({ value: message.items?.[0]?.value ?? null })
    }
    return reply({ ok: false, message: 'not supported by the check' })
  }
  return host
}

/** @returns {Promise<{ ok: boolean, lines: string[] }>} */
export async function checkEditor(editorDir, slidesFile, { browser: browserName = 'chromium', screenshot, headed = false } = {}) {
  const lectureText = readFileSync(slidesFile, 'utf8')
  const site = await serveEditor(editorDir)
  const sitePort = site.address().port
  const base = `http://127.0.0.1:${sitePort}${EDITOR_PREFIX}`

  let assets
  try {
    const index = await fetch(`${base}index.html`)
    if (!index.ok) throw new Error(`HTTP ${index.status}`)
    const html = await index.text()
    if (editorProtocol(html) !== EDITOR_PROTOCOL) {
      throw new Error(`it states messages version ${editorProtocol(html)}, expected ${EDITOR_PROTOCOL}`)
    }
    assets = editorAssets(html, base)
  } catch (err) {
    stopServer(site)
    return { ok: false, lines: [`the editor page at ${base} is not usable: ${err.message}`] }
  }
  const pageFor = (render) => panelPage({ base, ...assets, render })
  let formSubmitted = false

  // the webview host, on another origin than the site (a different port)
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const respond = (type, body, headers) => res.writeHead(200, { 'content-type': type, ...headers }).end(body)
    if (url.pathname === '/') return respond('text/html; charset=utf-8', HOST_HTML, ISOLATED)
    if (url.pathname === '/host.js') return respond('text/javascript; charset=utf-8', HOST_JS, ISOLATED)
    if (url.pathname === '/fake.html') {
      return respond('text/html; charset=utf-8', FAKE_HTML, url.searchParams.get('vscode-coi') === '3' ? ISOLATED : {})
    }
    if (url.pathname === '/form-submitted') {
      formSubmitted = true
      return respond('text/html; charset=utf-8', 'submitted', ISOLATED)
    }
    res.writeHead(404).end()
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const hostPort = server.address().port
  const host = createHost(dirname(resolve(slidesFile)), lectureText)

  const errors = []
  const lines = []
  let allowCspReports = false
  let browser
  try {
    browser = await launchBrowser(browserName, { headed })
    const page = await browser.newPage()
    await page.exposeFunction('__hostRequest', (message) => host.answer(message))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      if (allowCspReports && /Content.Security.Policy|form submission|sandbox/i.test(msg.text())) return
      errors.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()} (${req.failure()?.errorText})`))
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`)
    })
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.protocol === 'data:' || url.protocol === 'blob:') return
      const local = url.hostname === '127.0.0.1' && (url.port === String(sitePort) || url.port === String(hostPort))
      if (!local) errors.push(`request outside the site: ${req.url()}`)
    })

    const fromRuntime = (match, timeout = 30000) =>
      page
        .waitForFunction((m) => window.__toExtension.find((x) => Object.entries(m).every(([k, v]) => x[k] === v)), match, { timeout })
        .then((handle) => handle.jsonValue(), () => null)
    const toRuntime = (message) => page.evaluate((m) => window.postToWebview(m), message)
    let seq = 0
    /** send slides.md (and the scene files) as the extension does; returns its number */
    const source = async (text) => {
      seq += 1
      await toRuntime({ type: 'lysark:source', files: host.files(text), seq, slide: 0, protocol: EDITOR_PROTOCOL })
      return seq
    }
    const render = async (n) => {
      await page.evaluate((html) => window.setHtml(html), pageFor(n))
      return fromRuntime({ type: 'lysark:ready', render: n, protocol: EDITOR_PROTOCOL })
    }
    // run a function on the panel's window (the frame VS Code would show)
    const inPanel = (fn, arg) =>
      page.evaluate(
        ([source, a]) => new Function('w', 'a', `return (${source})(w, a)`)(document.getElementById('active-frame').contentWindow, a),
        [fn.toString(), arg ?? null],
      )
    const fail = (what) => ({ ok: false, lines: [...lines, what, ...errors] })
    /** the panel's camera, relative to the point it looks at */
    const cameraOffset = () =>
      inPanel((w) => {
        const L = w.__lysark
        if (!L || L.sceneManager.busy) return null
        const p = L.sceneLayer.camera.position
        const t = L.cameraCtl.active ? L.cameraCtl.lookTarget : L.controls.target
        return [p.x - t.x, p.y - t.y, p.z - t.z]
      })
    const banner = () => inPanel((w) => [...w.document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.bottom === '12px')?.textContent ?? '')
    const waitFor = async (test, tries = 40, every = 500) => {
      for (let i = 0; i < tries; i++) {
        const value = await test()
        if (value) return value
        await page.waitForTimeout(every)
      }
      return null
    }

    // 1. the panel loads, isolated, and shows the lecture with its images
    await page.goto(`http://127.0.0.1:${hostPort}/`)
    if (!(await page.evaluate(() => window.crossOriginIsolated))) return fail('the host page is not cross-origin isolated, so this check proves nothing')
    const ready = await render(1)
    if (!ready) return fail('the runtime never said ready (did its files load under the isolation policy?)')
    if (!Array.isArray(ready.include) || !ready.include.includes('scenes/*.yaml')) {
      return fail(`'ready' names no scene files to include: ${JSON.stringify(ready.include)}`)
    }
    const frame = await inPanel((w) => ({ isolated: w.crossOriginIsolated, parentIsSelf: w.parent === w }))
    if (!frame.isolated || !frame.parentIsSelf) return fail(`the panel frame is not like VS Code's: ${JSON.stringify(frame)}`)
    const first = await source(host.doc.text)
    if (!(await fromRuntime({ type: 'lysark:shown', seq: first }))) return fail('the lecture was not shown')
    lines.push('lecture shown in a cross-origin-isolated panel')
    const styles = await inPanel((w) => ({
      defaultStyles: !!w.document.getElementById('_defaultStyles'),
      loading: !!w.document.getElementById('lysark-loading'),
    }))
    if (styles.defaultStyles || styles.loading) {
      return fail(`VS Code's default styles or the loading text are still there: ${JSON.stringify(styles)}`)
    }
    // the hint says that saving updates the panel (github.dev's auto-save doesn't)
    const hintText = await inPanel((w) => [...w.document.querySelectorAll('div')].find((d) => d.style.top === '10px')?.textContent ?? '')
    if (!/Ctrl\+S/.test(hintText)) return fail(`the panel's hint doesn't say that Ctrl+S updates the preview: ${JSON.stringify(hintText)}`)
    // the images the panel read, and the slides the deck runs: each image in them, no placeholder
    const images = await inPanel((w) => {
      const uris = Object.values(w.__LYSARK_IMAGES__ ?? {})
      const slides = JSON.stringify(w.__lysark?.engine.opts?.slides ?? null)
      return { uris, inSlides: uris.filter((uri) => slides.includes(uri)).length, placeholder: slides.includes('image%20not%20shown') }
    })
    if (images.uris.some((uri) => !/^data:image\/[a-z+]+;base64,./.test(uri))) return fail('an image in the panel is not a data URI')
    if (host.served > 0 && images.uris.length === 0) return fail('image files were read, but the panel shows none')
    if (host.served === 0 && /!\[[^\]]*\]\(|<img\b/i.test(lectureText)) return fail('the lecture has images, but the panel read none')
    if (images.inSlides !== images.uris.length || images.placeholder) {
      return fail(`the deck's slides don't show the images read: ${JSON.stringify({ read: images.uris.length, inSlides: images.inSlides, placeholder: images.placeholder })}`)
    }
    lines.push(`${images.uris.length} image${images.uris.length === 1 ? '' : 's'} read through the host and shown in the slides as data URIs`)

    // 2. V: the panel reads slides.md, computes the edit, and asks the host to
    //    apply it to the version it read. First with typing in between, which
    //    the host refuses; then from Scene Actions, which asks which action
    //    first. The first slide's scene builds after it shows, so ask until it answers.
    // once the scene is there, turn the camera a little, as dragging in the panel would
    const turned = await waitFor(() =>
      inPanel((w) => {
        const L = w.__lysark
        if (!L || L.sceneManager.busy || !L.sceneManager.active || L.sceneManager.activeSceneId !== L.engine.current.scene) return false
        L.sceneLayer.camera.position.x += 0.3
        return true
      }),
    )
    if (!turned) return fail('the first slide\'s scene never finished loading')
    host.typeBeforeNextEdit = true
    await toRuntime({ type: 'lysark:request-view' })
    const refused = await waitFor(async () => host.edits[0], 20, 300)
    if (!refused) return fail(`pressing V never asked the host for an edit (the panel says: ${await banner()})`)
    if (refused.result.ok || host.doc.text !== lectureText) return fail('an edit computed on an older version was applied')
    if (!(await waitFor(async () => /not saved/.test(await banner()), 10, 300))) {
      return fail(`the panel did not say the view was not saved: ${await banner()}`)
    }
    lines.push('a view computed on an older version of slides.md was refused, and the panel said so')
    await toRuntime({ type: 'lysark:request-actions' })
    const saved = await waitFor(async () => host.edits[1], 20, 300)
    if (!saved?.result.ok) return fail(`saving the view from Scene Actions failed: ${JSON.stringify(saved?.result ?? null)}`)
    const change = saved.message.changes[0]
    const fm = frontmatterLines(lectureText, 0)
    const lineOf = (offset) => lectureText.slice(0, offset).split('\n').length - 1
    if (!fm || lineOf(change.start) < fm.from || lineOf(change.end) > fm.to) {
      return fail(`the saved view changed text outside the first slide's frontmatter: ${JSON.stringify(change)}`)
    }
    lines.push(`saved view written into slide 1 as one small edit: ${JSON.stringify(change.text)}`)
    if (screenshot) {
      await page.waitForTimeout(2500) // past the slide's entry fade
      await page.screenshot({ path: screenshot })
    }
    // the extension then sends the edited text: only a camera changed, so in place
    const afterSave = await source(host.doc.text)
    if (!(await fromRuntime({ type: 'lysark:shown', seq: afterSave }, 10000))) return fail('the saved view was not put into the running deck')

    // 2b. text that only changes another slide's camera goes into the running
    //     deck without loading afresh, and flying to that slide lands on it
    const moved = moveSlideCamera(host.doc.text)
    if (moved) {
      const cameraOnly = await source(moved.text)
      if (!(await fromRuntime({ type: 'lysark:shown', seq: cameraOnly }, 10000))) return fail('a camera-only change was not shown')
      const reloaded = await page.evaluate(() => window.__toExtension.some((m) => m.type === 'lysark:accepted'))
      if (reloaded) return fail('a camera-only change made the panel load afresh instead of updating in place')
      host.doc = { text: moved.text, version: host.doc.version + 1 }
      await toRuntime({ type: 'lysark:goto', slide: moved.slide })
      // read the camera until the flight there has settled
      let last = null
      const settled = await waitFor(async () => {
        const now = await cameraOffset()
        const still = now && last && now.every((n, k) => Math.abs(n - last[k]) < 0.002)
        last = now
        return still ? now : null
      }, 30)
      if (!settled) return fail(`the camera never settled on slide ${moved.slide + 1}`)
      if (!settled.every((n, k) => Math.abs(n - moved.offset[k]) < 0.02)) {
        return fail(`slide ${moved.slide + 1} flew to the old view: offset ${JSON.stringify(settled)}, expected ${JSON.stringify(moved.offset)}`)
      }
      lines.push(`camera-only change put in place, no reload; slide ${moved.slide + 1} now flies to offset ${JSON.stringify(moved.offset)}`)
    } else {
      lines.push('(no slide after the first has its own camera offset, so the in-place camera update was not checked)')
    }

    // 2c. V on a slide that names a view (`camera: overview`) writes into that
    //     view in the scene file; the other slides that name it fly to it too
    const named = namedViews(host.doc.text).find((v) => v.slides.length > 1)
    if (named) {
      const path = [`scenes/${named.scene}.yaml`, `scenes/${named.scene}.yml`].find((p) => host.docs.has(p))
      if (!path) return fail(`slides name the view '${named.view}', but the check found no scenes/${named.scene}.yaml`)
      const [first, second] = named.slides
      await toRuntime({ type: 'lysark:goto', slide: first })
      const ready = await waitFor(() =>
        inPanel((w, slide) => {
          const L = w.__lysark
          return L?.engine.currentIndex === slide && !L.sceneManager.busy && !L.cameraCtl.active
        }, first),
      )
      if (!ready) return fail(`the panel never settled on slide ${first + 1}, which names the view '${named.view}'`)
      await inPanel((w) => {
        w.__lysark.sceneLayer.camera.position.x += 0.3
      })
      const editsBefore = host.edits.length
      await toRuntime({ type: 'lysark:request-view' })
      const edit = await waitFor(async () => host.edits[editsBefore], 20, 300)
      if (!edit?.result.ok || edit.message.changes[0].path !== path) {
        return fail(`V on slide ${first + 1} did not write the view '${named.view}' into ${path}: ${JSON.stringify(edit ?? null)}`)
      }
      const saved = parseYaml(host.docs.get(path).text).views[named.view]
      // the extension then sends the scene file with slides.md as last sent: only cameras changed
      const inPlace = await source(host.doc.text)
      if (!(await fromRuntime({ type: 'lysark:shown', seq: inPlace }, 10000))) return fail('the saved named view was not put into the running deck')
      if (await page.evaluate((n) => window.__toExtension.some((m) => m.type === 'lysark:accepted' && m.seq === n), inPlace)) {
        return fail('saving a named view made the panel load afresh instead of updating in place')
      }
      await toRuntime({ type: 'lysark:goto', slide: second })
      let last = null
      const settled = await waitFor(async () => {
        const now = await inPanel((w, slide) => (w.__lysark.engine.currentIndex === slide ? null : 'elsewhere'), second).then((x) => (x ? null : cameraOffset()))
        const still = now && last && now.every((n, k) => Math.abs(n - last[k]) < 0.002)
        last = now
        return still ? now : null
      }, 30)
      if (!settled || !settled.every((n, k) => Math.abs(n - saved.offset[k]) < 0.02)) {
        return fail(`slide ${second + 1}, which also names '${named.view}', did not fly to the saved view: ${JSON.stringify(settled)}, expected ${JSON.stringify(saved.offset)}`)
      }
      lines.push(`V on slide ${first + 1} saved the view '${named.view}' in ${path}; slide ${second + 1}, which names it too, flies to ${JSON.stringify(saved.offset)}`)
    } else {
      lines.push('(the lecture has no view named by two slides, so saving a named view was not checked)')
    }

    // 2d. Shift+V, Save view as…, on a slide whose scene has no scene file: the
    //     panel's own dialog (the deck's keys wait), a new view, saved as one
    //     edit that names it on the slide and creates the scene file
    const bare = (() => {
      const lines2 = host.doc.text.replace(/\r\n/g, '\n').split('\n')
      for (let n = 0; ; n++) {
        const range = frontmatterLines(host.doc.text, n)
        if (!range) return null
        let fm
        try {
          fm = parseYaml(lines2.slice(range.from, range.to).join('\n'))
        } catch {
          continue
        }
        const scene = fm?.scene
        if (typeof scene === 'string' && !host.docs.has(`scenes/${scene}.yaml`) && !host.docs.has(`scenes/${scene}.yml`)) return { slide: n, scene }
      }
    })()
    if (bare) {
      await toRuntime({ type: 'lysark:goto', slide: bare.slide })
      const there = await waitFor(() =>
        inPanel((w, slide) => {
          const L = w.__lysark
          return L?.engine.currentIndex === slide && !L.sceneManager.busy && !L.cameraCtl.active && L.sceneManager.activeSceneId === L.engine.current.scene
        }, bare.slide),
      )
      if (!there) return fail(`the panel never settled on slide ${bare.slide + 1} (scene '${bare.scene}')`)
      await inPanel((w) => {
        w.__lysark.sceneLayer.camera.position.x += 0.25
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'V', shiftKey: true }))
      })
      const opened = await waitFor(() => inPanel((w) => !!w.document.querySelector('[role="dialog"] input')), 20, 200)
      if (!opened) return fail('Shift+V did not open the Save view as… dialog')
      // while it is open, an arrow key doesn't move the deck (to the next slide,
      // or the next step of this one), and V doesn't save
      const editsBefore = host.edits.length
      const stayed = await inPanel((w) => {
        const E = w.__lysark.engine
        const at = () => JSON.stringify([E.currentIndex, E.visibleChunks, w.location.hash])
        const before = at()
        // as a key press does: to the focused element, the dialog
        const box = w.document.querySelector('[role="dialog"]')
        box.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        box.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'v', bubbles: true }))
        return at() === before
      })
      await page.waitForTimeout(800)
      if (!stayed) return fail('an arrow key moved the deck while the Save view as… dialog was open')
      if (host.edits.length !== editsBefore) return fail('V saved a view while the Save view as… dialog was open')
      const slidesBefore = host.doc.text
      await inPanel((w) => {
        const input = w.document.querySelector('[role="dialog"] input')
        input.value = 'checked'
        input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      const edit = await waitFor(async () => host.edits[editsBefore], 20, 300)
      const path = `scenes/${bare.scene}.yaml`
      const kinds = edit?.message.changes.map((c) => (typeof c.create === 'string' ? `create ${c.path}` : c.path)) ?? []
      if (!edit?.result.ok || JSON.stringify(kinds) !== JSON.stringify(['slides.md', `create ${path}`])) {
        return fail(`Save view as… a new view did not name it on the slide and create ${path}: ${JSON.stringify(edit ?? null)}`)
      }
      const created = parseYaml(host.docs.get(path).text)
      if (created?.base !== bare.scene || !created?.views?.checked) return fail(`the new scene file is not right: ${host.docs.get(path).text}`)
      const range = frontmatterLines(host.doc.text, bare.slide)
      const fm = parseYaml(host.doc.text.replace(/\r\n/g, '\n').split('\n').slice(range.from, range.to).join('\n'))
      if (fm.camera !== 'checked') return fail(`slide ${bare.slide + 1} doesn't name the new view: camera is ${JSON.stringify(fm.camera)}`)
      // the extension sends the edited files, the way VS Code reports them: first
      // the created file (with slides.md as last sent), then the edit's own text.
      // The slide's camera is now the view, so only cameras changed
      const between = await source(slidesBefore)
      if (!(await fromRuntime({ type: 'lysark:shown', seq: between }, 10000))) return fail('the new scene file alone was not shown')
      const named2 = await source(host.doc.text)
      if (!(await fromRuntime({ type: 'lysark:shown', seq: named2 }, 10000))) return fail('the new view was not put into the running deck')
      if (await page.evaluate((n) => window.__toExtension.some((m) => m.type === 'lysark:accepted' && m.seq === n), named2)) {
        return fail('saving a new view made the panel load afresh instead of updating in place')
      }
      lines.push(`Shift+V on slide ${bare.slide + 1}: the dialog held the keys, and a new view 'checked' was saved as one edit to slides.md and a new ${path}`)
    } else {
      lines.push('(every scene in the lecture has a scene file, so creating one was not checked)')
    }

    // 3. other new text is accepted; the extension loads the page afresh and sends it on 'ready'
    const added = `${host.doc.text}\n---\nid: added-by-check\n---\n# Added\n`
    const structural = await source(added)
    if (!(await fromRuntime({ type: 'lysark:accepted', seq: structural }))) return fail('a new, valid text was not accepted')
    await page.evaluate((html) => window.setHtml(html), pageFor(2))
    await toRuntime({ type: 'lysark:goto', slide: 1 }) // sent during the swap: may be dropped, must do no harm
    if (!(await fromRuntime({ type: 'lysark:ready', render: 2 }))) return fail('the runtime did not say ready after loading afresh')
    await toRuntime({ type: 'lysark:source', files: host.files(added), seq: structural, slide: 0, protocol: EDITOR_PROTOCOL })
    if (!(await fromRuntime({ type: 'lysark:shown', seq: structural }))) return fail('the new text was not shown after loading afresh')
    lines.push('new text accepted, and shown after the panel loaded afresh')

    // 4. a broken text is refused, and the shown text stays
    const deck = () => inPanel((w) => ({ slides: w.__lysark?.engine.slideCount ?? null, overlay: w.document.getElementById('overlay-layer')?.children.length ?? 0 }))
    const before = await deck()
    const broken = await source('---\nscene: no-such-scene\n---\n# x\n')
    const error = await fromRuntime({ type: 'lysark:error', seq: broken })
    if (!error) return fail('a text with an unknown scene was not refused')
    const after4 = await deck()
    if (after4.slides !== before.slides || after4.overlay === 0) {
      return fail(`the shown lecture did not stay after a refused text: ${JSON.stringify({ before, after: after4 })}`)
    }
    lines.push(`broken text refused, shown lecture kept: ${error.message.split('\n')[0]}`)

    // 5. script in lecture text never runs, and the panel survives the attempts
    allowCspReports = true
    const scripted = await source(SCRIPT_TEST)
    if (!(await fromRuntime({ type: 'lysark:accepted', seq: scripted }))) return fail('the script-test text was not accepted')
    if (!(await render(3))) return fail('the runtime did not say ready for the script test')
    await toRuntime({ type: 'lysark:source', files: { 'slides.md': SCRIPT_TEST }, seq: scripted, slide: 0, protocol: EDITOR_PROTOCOL })
    if (!(await fromRuntime({ type: 'lysark:shown', seq: scripted }))) return fail('the script-test text was not shown')
    // the ontoggle handler would run as soon as the slide shows; check before the clicks below
    await page.waitForTimeout(500)
    const onShow = await inPanel((w) => w.__ran ?? null)
    if (onShow) return fail(`script in the lecture text ran: ${onShow}`)
    await inPanel((w) => {
      const click = (id) => w.document.getElementById(id)?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
      click('t2')
      click('t3')
      try {
        w.document.getElementById('t4')?.requestSubmit()
      } catch {
        // refused outright: fine
      }
    })
    await page.waitForTimeout(1500)
    const after = await inPanel((w) => ({ ran: w.__ran ?? null, runtime: typeof w.__lysark }))
    if (after.ran) return fail(`script in the lecture text ran: ${after.ran}`)
    if (formSubmitted) return fail('a form in the lecture text was submitted')
    if (after.runtime !== 'object') return fail('the panel did not survive the script test (a link or form replaced it)')
    lines.push('script in lecture text did not run (inline handler, javascript: links, a form)')

    if (host.outside.length > 0) errors.push(`the panel asked for files outside the lecture folder: ${host.outside.join(', ')}`)
    return { ok: errors.length === 0, lines: [...lines, ...errors] }
  } catch (err) {
    // our own errors (a missing browser, with how to install it) in full; Playwright's long ones cut short
    const text = String(err?.message ?? err)
    return { ok: false, lines: [...lines, `check failed: ${err?.cause ? text : text.split('\n')[0]}`, ...errors] }
  } finally {
    await browser?.close()
    stopServer(site)
    stopServer(server)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args.splice(i, 2)[1] : undefined
  }
  const browser = option('browser') ?? 'chromium'
  const screenshot = option('screenshot')
  // a visible window (CI runs Firefox like this under a virtual display, for its OpenGL)
  const headed = args.includes('--headed')
  if (headed) args.splice(args.indexOf('--headed'), 1)
  const [dir, slides] = args
  if (!dir || !slides) {
    console.error('Usage: node scripts/check-editor.mjs <editor dir> <slides.md> [--browser firefox] [--screenshot file.png]')
    process.exit(1)
  }
  const started = Date.now()
  const report = await checkEditor(dir, slides, { browser, screenshot, headed })
  console.log(`${report.ok ? '✓' : '✗'} editor runtime in ${dir} (${browser}, ${Math.round((Date.now() - started) / 1000)} s)`)
  for (const line of report.lines) console.log(`   ${line}`)
  if (!report.ok && process.env.GITHUB_ACTIONS) {
    // the run's annotations show this without opening the log
    const text = report.lines.join(' | ').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.log(`::error title=Editor check (${browser})::${text}`)
  }
  process.exit(report.ok ? 0 : 1)
}
