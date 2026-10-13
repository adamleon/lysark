// Static PDF exporter (lysark-design.md §9c): drive a student file through every
// slide with Playwright, wait for each to settle (§5) with a generous fixed
// fallback, screenshot canvas + overlay at full resolution, and composite one
// page per slide. Loads the file over file:// — no server needed.
import { PDFDocument } from 'pdf-lib'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { launchChromium } from './browser.mjs'

// full-resolution capture: CSS viewport × deviceScaleFactor = screenshot pixels
const VIEWPORT = { width: 1600, height: 900 }
const SCALE = 2
const MAX_SETTLE_MS = 4000 // §9c fallback: unstable-gain / idle slides never settle
const REVEAL_MS = 550 // let the overlay fade-in + anchor reveal finish after settle

export async function exportPdf(file, outFile, log = () => {}) {
  const htmlPath = resolve(file)
  if (!existsSync(htmlPath)) throw new Error(`${htmlPath} not found`)
  const fileUrl = pathToFileURL(htmlPath).href

  const browser = await launchChromium()
  const shots = []
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    try {
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__lysark, null, { timeout: 15000 })
    } catch (err) {
      throw new Error(`deck did not start: ${pageErrors[0] ?? String(err.message).split('\n')[0]}`)
    }

    const slideCount = await page.evaluate(() => window.__lysark.engine.slideCount)

    /** wait for the transition/fade to finish, then for settle (or the fallback). */
    const waitSlideReady = async () => {
      await page.waitForFunction(() => !window.__lysark.sceneManager.busy, null, { timeout: 15000 })
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

    for (let i = 0; i < slideCount; i++) {
      // sequential nav so scene boundaries crossfade naturally; showAllFragments
      // gives each slide's complete end state, not its first reveal step
      await page.evaluate((n) => {
        if (n !== window.__lysark.engine.currentIndex) window.__lysark.engine.goTo(n, 'forward')
        window.__lysark.engine.showAllFragments()
      }, i)
      await waitSlideReady()
      shots.push(await page.screenshot({ type: 'png' }))
      log(`slide ${i + 1}/${slideCount}`)
    }
  } finally {
    await browser.close()
  }

  // one page per slide, sized to the screenshot pixels (full-bleed)
  const pdf = await PDFDocument.create()
  for (const png of shots) {
    const img = await pdf.embedPng(png)
    const pageDoc = pdf.addPage([img.width, img.height])
    pageDoc.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  }
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  writeFileSync(outFile, await pdf.save())
  return shots.length
}
