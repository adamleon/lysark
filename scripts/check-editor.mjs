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
// - the check plays the extension: it sends texts, loads the page afresh when
//   a text is accepted, and asks for a saved view.
//
// It requires: the lecture shown in an isolated panel, VS Code's default styles
// gone, a saved view, a new text accepted and shown after a reload, a broken
// text refused, script in lecture text never run (inline handler, javascript:
// links, a form), no errors, and no requests anywhere else. Engine CI runs it
// on the course-style build in Chromium and Firefox.
//
//   node scripts/check-editor.mjs <editor dir> <slides.md> [--browser firefox] [--screenshot file.png]
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
window.__vscode_post_message__ = (command, data) => { if (command === 'onmessage') window.__toExtension.push(data.message) }
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

/** @returns {Promise<{ ok: boolean, lines: string[] }>} */
export async function checkEditor(editorDir, slidesFile, { browser: browserName = 'chromium', screenshot } = {}) {
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
  const host = createServer((req, res) => {
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
  await new Promise((done) => host.listen(0, '127.0.0.1', done))
  const hostPort = host.address().port

  const errors = []
  const lines = []
  let allowCspReports = false
  let browser
  try {
    browser = await launchBrowser(browserName)
    const page = await browser.newPage()
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
    const source = (text, seq) => toRuntime({ type: 'lysark:source', text, seq, slide: 0, protocol: EDITOR_PROTOCOL })
    const render = async (n) => {
      await page.evaluate((html) => window.setHtml(html), pageFor(n))
      return fromRuntime({ type: 'lysark:ready', render: n, protocol: EDITOR_PROTOCOL })
    }
    // run a function on the panel's window (the frame VS Code would show)
    const inPanel = (fn) =>
      page.evaluate((source) => new Function('w', `return (${source})(w)`)(document.getElementById('active-frame').contentWindow), fn.toString())
    const fail = (what) => ({ ok: false, lines: [...lines, what, ...errors] })

    // 1. the panel loads, isolated, and shows the lecture
    await page.goto(`http://127.0.0.1:${hostPort}/`)
    if (!(await page.evaluate(() => window.crossOriginIsolated))) return fail('the host page is not cross-origin isolated, so this check proves nothing')
    if (!(await render(1))) return fail('the runtime never said ready (did its files load under the isolation policy?)')
    const frame = await inPanel((w) => ({ isolated: w.crossOriginIsolated, parentIsSelf: w.parent === w }))
    if (!frame.isolated || !frame.parentIsSelf) return fail(`the panel frame is not like VS Code's: ${JSON.stringify(frame)}`)
    await source(lectureText, 1)
    if (!(await fromRuntime({ type: 'lysark:shown', seq: 1 }))) return fail('the lecture was not shown')
    lines.push('lecture shown in a cross-origin-isolated panel')
    const styles = await inPanel((w) => ({
      defaultStyles: !!w.document.getElementById('_defaultStyles'),
      loading: !!w.document.getElementById('lysark-loading'),
    }))
    if (styles.defaultStyles || styles.loading) {
      return fail(`VS Code's default styles or the loading text are still there: ${JSON.stringify(styles)}`)
    }

    // 2. a saved view; the first slide's scene builds after it shows, so ask until it answers
    let view = null
    for (let i = 0; i < 40 && !view; i++) {
      await toRuntime({ type: 'lysark:request-view' })
      view = await fromRuntime({ type: 'lysark:save-view' }, 500)
    }
    if (!view) return fail('no saved view came back from slide 1')
    if (view.seq !== 1) return fail(`the saved view names text ${view.seq}, expected 1`)
    lines.push(`saved view: ${JSON.stringify(view.view)}`)
    if (screenshot) {
      await page.waitForTimeout(2500) // past the slide's entry fade
      await page.screenshot({ path: screenshot })
    }

    // 3. new text is accepted; the extension loads the page afresh and sends it on 'ready'
    await source(`${lectureText}\n`, 2)
    if (!(await fromRuntime({ type: 'lysark:accepted', seq: 2 }))) return fail('a new, valid text was not accepted')
    await page.evaluate((html) => window.setHtml(html), pageFor(2))
    await toRuntime({ type: 'lysark:goto', slide: 1 }) // sent during the swap: may be dropped, must do no harm
    if (!(await fromRuntime({ type: 'lysark:ready', render: 2 }))) return fail('the runtime did not say ready after loading afresh')
    await source(`${lectureText}\n`, 2)
    if (!(await fromRuntime({ type: 'lysark:shown', seq: 2 }))) return fail('the new text was not shown after loading afresh')
    lines.push('new text accepted, and shown after the panel loaded afresh')

    // 4. a broken text is refused, and the shown text stays
    const deck = () => inPanel((w) => ({ slides: w.__lysark?.engine.slideCount ?? null, overlay: w.document.getElementById('overlay-layer')?.children.length ?? 0 }))
    const before = await deck()
    await source('---\nscene: no-such-scene\n---\n# x\n', 3)
    const refused = await fromRuntime({ type: 'lysark:error', seq: 3 })
    if (!refused) return fail('a text with an unknown scene was not refused')
    const after4 = await deck()
    if (after4.slides !== before.slides || after4.overlay === 0) {
      return fail(`the shown lecture did not stay after a refused text: ${JSON.stringify({ before, after: after4 })}`)
    }
    lines.push(`broken text refused, shown lecture kept: ${refused.message.split('\n')[0]}`)

    // 5. script in lecture text never runs, and the panel survives the attempts
    allowCspReports = true
    await source(SCRIPT_TEST, 4)
    if (!(await fromRuntime({ type: 'lysark:accepted', seq: 4 }))) return fail('the script-test text was not accepted')
    if (!(await render(3))) return fail('the runtime did not say ready for the script test')
    await source(SCRIPT_TEST, 4)
    if (!(await fromRuntime({ type: 'lysark:shown', seq: 4 }))) return fail('the script-test text was not shown')
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

    return { ok: errors.length === 0, lines: [...lines, ...errors] }
  } catch (err) {
    // our own errors (a missing browser, with how to install it) in full; Playwright's long ones cut short
    const text = String(err?.message ?? err)
    return { ok: false, lines: [...lines, `check failed: ${err?.cause ? text : text.split('\n')[0]}`, ...errors] }
  } finally {
    await browser?.close()
    stopServer(site)
    stopServer(host)
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
  const [dir, slides] = args
  if (!dir || !slides) {
    console.error('Usage: node scripts/check-editor.mjs <editor dir> <slides.md> [--browser firefox] [--screenshot file.png]')
    process.exit(1)
  }
  const report = await checkEditor(dir, slides, { browser, screenshot })
  console.log(`${report.ok ? '✓' : '✗'} editor runtime in ${dir} (${browser})`)
  for (const line of report.lines) console.log(`   ${line}`)
  process.exit(report.ok ? 0 : 1)
}
