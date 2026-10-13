// Single-file offline acceptance test (lysark-design.md §9b): load a student
// file over a real file:// URL — no server — step every slide, and assert ZERO
// console errors, uncaught exceptions, or (attempted) network requests. This is
// the automated form of "double-click on a clean machine": if any stray fetch /
// dynamic import / external asset slipped in, file:// makes it fail loudly and
// this catches it.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { launchChromium } from './browser.mjs'

// KaTeX ships ~20 faces across ~10 families
const MIN_KATEX_FACES = 16

/** @returns {Promise<{ ok: boolean, lines: string[] }>} */
export async function checkOffline(file) {
  const htmlPath = resolve(file)
  if (!existsSync(htmlPath)) return { ok: false, lines: [`${htmlPath} not found`] }
  const fileUrl = pathToFileURL(htmlPath).href

  const consoleErrors = []
  const pageErrors = []
  const requests = [] // any network request at all is suspect under file://

  const browser = await launchChromium()
  try {
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

    try {
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__lysark, null, { timeout: 15000 })
    } catch (err) {
      // report what the page itself said, not just the timeout
      return {
        ok: false,
        lines: [
          `deck did not start: ${String(err.message).split('\n')[0]}`,
          ...pageErrors.map((e) => `  pageerror: ${e}`),
          ...consoleErrors.map((e) => `  console.error: ${e}`),
          ...requests.map((r) => `  request: ${r}`),
        ],
      }
    }

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

    // KaTeX font integrity: a broken CSS inline pass drops fonts WITHOUT any
    // console error or network request, so the checks above are blind to it —
    // math would just render in a fallback serif. Assert the faces survived.
    const katexFaces = await page.evaluate(
      () => [...document.fonts].filter((f) => f.family.startsWith('KaTeX')).length,
    )

    const ok =
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      requests.length === 0 &&
      katexFaces >= MIN_KATEX_FACES
    const lines = [
      `slides stepped: ${slideCount} (forward + backward)`,
      `console errors: ${consoleErrors.length}`,
      `uncaught exceptions: ${pageErrors.length}`,
      `external/network requests: ${requests.length}`,
      `KaTeX @font-face rules: ${katexFaces} (expect ≥ ${MIN_KATEX_FACES})`,
      ...consoleErrors.map((e) => `  console.error: ${e}`),
      ...pageErrors.map((e) => `  pageerror: ${e}`),
      ...requests.map((r) => `  request: ${r}`),
    ]
    return { ok, lines }
  } finally {
    await browser.close()
  }
}
