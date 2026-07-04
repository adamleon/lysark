// Single-file offline acceptance test (spec §9b): load lysark-offline.html over
// a real file:// URL — no server — step every slide, and assert ZERO console
// errors, uncaught exceptions, or (attempted) network requests. This is the
// automated form of the spec's "double-click on a clean machine" test: if any
// stray fetch / dynamic import / external asset slipped in, file:// makes it
// fail loudly and this catches it.
import { chromium } from 'playwright-chromium'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const htmlPath = resolve('dist-offline/lysark-offline.html')
if (!existsSync(htmlPath)) {
  console.error(`✗ ${htmlPath} not found — run 'npm run build:offline' first.`)
  process.exit(1)
}
const fileUrl = pathToFileURL(htmlPath).href

const consoleErrors = []
const pageErrors = []
const requests = [] // any network request at all is suspect under file://

const browser = await chromium.launch()
const page = await browser.newPage()

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => pageErrors.push(err.message))
page.on('request', (req) => {
  // the document itself and inlined data: URIs are expected; anything else
  // (http(s), a sibling file, blob:) means an external dependency leaked in
  const url = req.url()
  if (url === fileUrl || url.startsWith('data:')) return
  requests.push(`${req.method()} ${url}`)
})

await page.goto(fileUrl, { waitUntil: 'load' })

// wait for the app to boot
await page.waitForFunction(() => !!window.__lysark, null, { timeout: 15000 })

// step through every slide so scene builds/boundaries/scene-less all execute —
// that is where a mesh/texture fetch would fire if one existed
const slideCount = await page.evaluate(() => window.__lysark.engine.slideCount)
for (let i = 0; i < slideCount; i++) {
  await page.evaluate((n) => window.__lysark.engine.goTo(n, 'forward'), i)
  await page.waitForTimeout(450) // transition + a few frames
}
// and back across every boundary (suspend/restore paths)
for (let i = slideCount - 2; i >= 0; i--) {
  await page.evaluate((n) => window.__lysark.engine.goTo(n, 'backward'), i)
  await page.waitForTimeout(300)
}

await browser.close()

const ok = consoleErrors.length === 0 && pageErrors.length === 0 && requests.length === 0
console.log(`slides stepped: ${slideCount} (forward + backward)`)
console.log(`console errors: ${consoleErrors.length}`)
console.log(`uncaught exceptions: ${pageErrors.length}`)
console.log(`external/network requests: ${requests.length}`)
for (const e of consoleErrors) console.log(`  console.error: ${e}`)
for (const e of pageErrors) console.log(`  pageerror: ${e}`)
for (const r of requests) console.log(`  request: ${r}`)

if (ok) {
  console.log('\n✓ offline acceptance passed — no server, no fetch, no external refs.')
  process.exit(0)
} else {
  console.error('\n✗ offline acceptance FAILED — see above.')
  process.exit(1)
}
