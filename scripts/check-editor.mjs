// Boot check for the editor runtime (lysark-v2.md §5, step 3), the way the VS
// Code panel uses it: serve a built runtime, frame it from a page on another
// origin, send it a lecture's text, and require that it shows the lecture and
// answers a saved-view request, with no errors and no requests leaving the
// server. Engine CI runs it on the course-style build, so a broken runtime
// never reaches a course site.
//
//   node scripts/check-editor.mjs <editor dir> <slides.md>
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChromium } from './browser.mjs'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

// stands in for the VS Code panel's relay: answer 'ready' with the text, and
// keep every message the runtime sends
const hostPage = (runtimeUrl, lectureText) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe id="f" src="${runtimeUrl}"></iframe>
<script>
  const lectureText = ${JSON.stringify(lectureText).replace(/</g, '\\u003c')}
  window.messages = []
  const frame = document.getElementById('f')
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return
    window.messages.push(e.data)
    if (e.data.type === 'lysark:ready') {
      frame.contentWindow.postMessage({ type: 'lysark:source', text: lectureText, seq: 1, slide: 0 }, '*')
    }
  })
  window.send = (message) => frame.contentWindow.postMessage(message, '*')
</script>`

/** start a server on 127.0.0.1 with a free port */
async function serve(handler) {
  const server = createServer(handler)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return server
}

function stop(server) {
  server.closeAllConnections()
  server.close()
}

/** @returns {Promise<{ ok: boolean, lines: string[] }>} */
export async function checkEditor(editorDir, slidesFile) {
  const root = resolve(editorDir)
  if (!existsSync(join(root, 'index.html'))) return { ok: false, lines: [`${root} has no index.html`] }
  const lectureText = readFileSync(slidesFile, 'utf8')

  // two servers, so the host page and the runtime are two origins, as the VS
  // Code panel and the course site are
  const site = await serve((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const prefix = '/_lysark/editor/'
    const rel = path.startsWith(prefix) ? path.slice(prefix.length) || 'index.html' : null
    const file = rel === null ? null : normalize(join(root, rel))
    if (!file || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  const sitePort = site.address().port
  const host = await serve((req, res) => {
    res.writeHead(200, { 'content-type': TYPES['.html'] })
    res.end(hostPage(`http://127.0.0.1:${sitePort}/_lysark/editor/`, lectureText))
  })
  const hostPort = host.address().port

  const errors = []
  const lines = []
  let browser
  try {
    browser = await launchChromium()
    const page = await browser.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()}`))
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`)
    })
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.protocol === 'data:') return
      const local = url.hostname === '127.0.0.1' && (url.port === String(sitePort) || url.port === String(hostPort))
      if (!local) errors.push(`request outside the site: ${req.url()}`)
    })

    await page.goto(`http://127.0.0.1:${hostPort}/`, { waitUntil: 'domcontentloaded' })
    const waitFor = (type, timeout) =>
      page.waitForFunction((t) => window.messages.some((m) => m.type === t), type, { timeout }).then(
        () => true,
        () => false,
      )

    if (!(await waitFor('lysark:shown', 30000))) {
      const said = await page.evaluate(() => window.messages)
      return { ok: false, lines: ['the runtime did not show the lecture', ...errors, `messages: ${JSON.stringify(said)}`] }
    }
    lines.push('lecture shown')

    // the first slide's scene builds after the slide shows; ask until it answers
    let saved = false
    for (let i = 0; i < 40 && !saved; i++) {
      await page.evaluate(() => window.send({ type: 'lysark:request-view' }))
      saved = await waitFor('lysark:save-view', 500)
    }
    if (!saved) return { ok: false, lines: [...lines, 'no saved view came back from slide 1', ...errors] }
    const view = await page.evaluate(() => window.messages.find((m) => m.type === 'lysark:save-view'))
    lines.push(`saved view: ${JSON.stringify(view.view)}`)
    return { ok: errors.length === 0, lines: [...lines, ...errors] }
  } catch (err) {
    return { ok: false, lines: [...lines, `check failed: ${String(err?.message ?? err).split('\n')[0]}`, ...errors] }
  } finally {
    await browser?.close()
    stop(site)
    stop(host)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, slides] = process.argv.slice(2)
  if (!dir || !slides) {
    console.error('Usage: node scripts/check-editor.mjs <editor dir> <slides.md>')
    process.exit(1)
  }
  const report = await checkEditor(dir, slides)
  console.log(`${report.ok ? '✓' : '✗'} editor runtime in ${dir}`)
  for (const line of report.lines) console.log(`   ${line}`)
  process.exit(report.ok ? 0 : 1)
}
