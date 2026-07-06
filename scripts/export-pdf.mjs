// Static PDF exporter (spec §9c): drive the built app through every slide with
// Playwright, wait for each to settle (§5) with a generous fixed fallback, screenshot
// canvas + overlay at full resolution, and composite one page per slide.
//
// Loads the self-contained single-file build over file:// — no server needed, and
// it is the artifact we already prove is offline-clean (npm run verify:offline).
//   npm run build:offline && npm run export:pdf
import { chromium } from 'playwright-chromium'
import { PDFDocument } from 'pdf-lib'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

// full-resolution capture: CSS viewport × deviceScaleFactor = screenshot pixels
const VIEWPORT = { width: 1600, height: 900 }
const SCALE = 2
const MAX_SETTLE_MS = 4000 // §9c fallback: unstable-gain / idle slides never settle
const REVEAL_MS = 550 // let the overlay fade-in + anchor reveal finish after settle
const OUT_DIR = 'pdf-export'

// same deck the offline build wrote (vite.config.ts DECK); default 'demo'
const deck = process.env.LYSARK_DECK || 'demo'
const OUT_FILE = resolve(OUT_DIR, `${deck}.pdf`)

const htmlPath = resolve('dist-offline', `${deck}-offline.html`)
if (!existsSync(htmlPath)) {
  console.error(`✗ ${htmlPath} not found — run 'npm run build:offline' first.`)
  process.exit(1)
}
const fileUrl = pathToFileURL(htmlPath).href

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
await page.goto(fileUrl, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__lysark, null, { timeout: 15000 })

const slideCount = await page.evaluate(() => window.__lysark.engine.slideCount)
console.log(`exporting ${slideCount} slides at ${VIEWPORT.width * SCALE}×${VIEWPORT.height * SCALE}…`)

/** wait for the transition/fade to finish, then for settle (or the fallback). */
async function waitSlideReady() {
  // transition + snapshot/canvas fade complete
  await page.waitForFunction(() => !window.__lysark.sceneManager.busy, null, { timeout: 15000 })
  // motion settled, or the generous fallback for idle / unstable-gain slides (§5, §9c)
  await page.evaluate(
    (maxMs) =>
      new Promise((res) => {
        const L = window.__lysark
        const t0 = Date.now()
        const check = () =>
          L.motion.settled() || Date.now() - t0 > maxMs ? res() : setTimeout(check, 32)
        check()
      }),
    MAX_SETTLE_MS,
  )
  await page.waitForTimeout(REVEAL_MS)
}

const shots = []
for (let i = 0; i < slideCount; i++) {
  // sequential nav so scene boundaries crossfade naturally; showAllFragments
  // gives each slide's complete end state, not its first reveal step
  await page.evaluate((n) => {
    if (n !== window.__lysark.engine.currentIndex) window.__lysark.engine.goTo(n, 'forward')
    window.__lysark.engine.showAllFragments()
  }, i)
  await waitSlideReady()
  shots.push(await page.screenshot({ type: 'png' }))
  process.stdout.write(`  slide ${i + 1}/${slideCount}\r`)
}
await browser.close()
console.log(`\ncaptured ${shots.length} slides`)

// one page per slide, sized to the screenshot pixels (full-bleed)
const pdf = await PDFDocument.create()
for (const png of shots) {
  const img = await pdf.embedPng(png)
  const pageDoc = pdf.addPage([img.width, img.height])
  pageDoc.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, await pdf.save())
console.log(`✓ wrote ${OUT_FILE} (${slideCount} pages)`)
