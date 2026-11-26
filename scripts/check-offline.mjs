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

/**
 * Runs in the page before its own scripts: when the deck exposes
 * window.__lysark (src/main.ts, before the first frame is drawn), notes how
 * many geometries and textures three.js holds on the GPU, so the check can
 * compare that with a slide without a scene once every scene has been shown.
 */
function recordGpuAtStart() {
  let value
  Object.defineProperty(window, '__lysark', {
    configurable: true,
    get: () => value,
    set: (next) => {
      value = next
      const memory = next?.sceneLayer?.renderer?.info?.memory
      if (memory && !window.__lysarkGpuAtStart) window.__lysarkGpuAtStart = { geometries: memory.geometries, textures: memory.textures }
    },
  })
}

/**
 * Runs in the page on a slide with a scene: finds three.js's own lookup table
 * for lit materials (r185's DFG_LUT, 16 x 16), which the renderer makes at
 * the first lit frame and keeps for the page, whatever scene comes or goes.
 * It is not a scene's, so the GPU check allows it, and only it.
 */
function findThreeLut() {
  if (window.__lysarkThreeLut) return
  const { renderer } = window.__lysark.sceneLayer
  window.__lysark.sceneManager.active?.root.traverse((node) => {
    for (const material of [node.material].flat()) {
      if (!material || !renderer.properties.has(material)) continue
      const lut = renderer.properties.get(material).uniforms?.dfgLUT?.value
      if (lut?.isTexture && lut.name === 'DFG_LUT') window.__lysarkThreeLut = lut
    }
  })
}

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

    await page.addInitScript(recordGpuAtStart)
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
    // three's lighting table is looked for once the slide's scene is built: a
    // large scene can take longer than the waits below, and until it is built
    // there is no scene to look in (goTo starts the transition at once)
    const lookForThreeLut = async () => {
      await page.waitForFunction(() => !window.__lysark.sceneManager.busy, null, { timeout: 15000 })
      await page.evaluate(findThreeLut)
    }
    const slideCount = await page.evaluate(() => window.__lysark.engine.slideCount)
    const sceneless = []
    for (let i = 0; i < slideCount; i++) {
      await page.evaluate((n) => window.__lysark.engine.goTo(n, 'forward'), i)
      await page.waitForTimeout(450) // transition + a few frames
      if (await page.evaluate(() => window.__lysark.engine.current.scene === undefined)) sceneless.push(i)
      else await lookForThreeLut()
    }
    // and back across every boundary (suspend/restore paths)
    for (let i = slideCount - 2; i >= 0; i--) {
      await page.evaluate((n) => window.__lysark.engine.goTo(n, 'backward'), i)
      await page.waitForTimeout(300)
      await lookForThreeLut()
    }

    // KaTeX font integrity: a broken CSS inline pass drops fonts WITHOUT any
    // console error or network request, so the checks above are blind to it —
    // math would just render in a fallback serif. Assert the faces survived.
    const katexFaces = await page.evaluate(
      () => [...document.fonts].filter((f) => f.family.startsWith('KaTeX')).length,
    )

    // GPU memory (lysark-design.md §4.1): every scene has now been shown and put
    // away; on a slide without a scene, three.js must hold no more geometries
    // or textures than before the first scene, or src/scene/dispose.ts left one
    let gpu = { ok: true, line: 'GPU memory: not checked (no slide without a scene)' }
    if (sceneless.length > 0) {
      const slide = sceneless[sceneless.length - 1]
      await page.evaluate((n) => window.__lysark.engine.goTo(n, 'forward'), slide)
      await page.waitForFunction(() => !window.__lysark.sceneManager.busy && window.__lysark.sceneManager.active === null, null, { timeout: 15000 })
      const { start, now, lut } = await page.evaluate(() => {
        const { renderer } = window.__lysark.sceneLayer
        const { memory } = renderer.info
        const lut = window.__lysarkThreeLut
        return {
          start: window.__lysarkGpuAtStart,
          now: { geometries: memory.geometries, textures: memory.textures },
          lut: lut !== undefined && renderer.properties.has(lut) ? 1 : 0,
        }
      })
      const same = start !== undefined && now.geometries === start.geometries && now.textures === start.textures + lut
      const was = start ? `${start.geometries} geometries, ${start.textures} textures` : 'not recorded'
      gpu = {
        ok: same,
        line:
          `GPU memory on slide ${slide + 1} (no scene), after every scene: ${now.geometries} geometries, ${now.textures} textures ` +
          `(before the first scene: ${was}${lut ? "; three.js's own lighting table since: 1 texture" : ''})` +
          `${same ? '' : ' — a scene left GPU memory behind'}`,
      }
    }

    const ok =
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      requests.length === 0 &&
      katexFaces >= MIN_KATEX_FACES &&
      gpu.ok
    const lines = [
      `slides stepped: ${slideCount} (forward + backward)`,
      `console errors: ${consoleErrors.length}`,
      `uncaught exceptions: ${pageErrors.length}`,
      `external/network requests: ${requests.length}`,
      `KaTeX @font-face rules: ${katexFaces} (expect ≥ ${MIN_KATEX_FACES})`,
      gpu.line,
      ...consoleErrors.map((e) => `  console.error: ${e}`),
      ...pageErrors.map((e) => `  pageerror: ${e}`),
      ...requests.map((r) => `  request: ${r}`),
    ]
    return { ok, lines }
  } finally {
    await browser.close()
  }
}
