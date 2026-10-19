// End-to-end check of the Lysark VS Code extension (docs/editor-host.md): the
// real extension in VS Code for the web (@vscode/test-web, cross-origin
// isolated like vscode.dev and github.dev), driven with Playwright, against an
// editor runtime served the way GitHub Pages serves it. For each editor
// folder it makes a small course from the demo lecture (an image in the
// lecture folder, one in the course's assets/, a scene file), opens slides.md,
// opens the preview and, by the runtime's message version:
//
//   3  images shown from both folders; saving a scene file sends the files
//      again; V and Scene Actions… write the view into slides.md; undoing that
//      edit reaches the panel
//   2  (engine v2.3.x) V writes the view; Scene Actions… says to update the engine
//
//   node scripts/check-extension.mjs <editor dir> [<editor dir> …]
//
// Not part of CI: the first run downloads VS Code Insiders (about 55 MB, into
// extension/.vscode-test-web), and the workbench's markup changes between
// Insiders builds. Run it before an extension release, with this engine's
// editor (`node bin/lysark.mjs editor-build`) and the previous release's.
import { execSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './browser.mjs'
import { EDITOR_PREFIX, serveEditor, stopServer } from './editor-server.mjs'
import { editorProtocol } from '../src/editor/panel-page.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION = join(ROOT, 'extension')
const TEST_WEB = '@vscode/test-web@0.0.80'

/** a course folder whose workspace settings point the extension at `editorUrl` */
function makeCourse(editorUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'lysark-course-'))
  const lecture = join(dir, 'lectures', 'demo')
  mkdirSync(join(lecture, 'scenes'), { recursive: true })
  mkdirSync(join(dir, 'assets'))
  mkdirSync(join(dir, '.vscode'))
  cpSync(join(ROOT, 'lectures/demo/images'), join(lecture, 'images'), { recursive: true })
  const slides = readFileSync(join(ROOT, 'lectures/demo/slides.md'), 'utf8')
  writeFileSync(join(lecture, 'slides.md'), `${slides}\n---\nid: asset-image\n---\n## An image from the course assets\n\n![dot](../../assets/dot.svg)\n`)
  writeFileSync(join(lecture, 'scenes/agilus.yaml'), 'base: agilus\n')
  writeFileSync(
    join(dir, 'assets/dot.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#c33"/></svg>\n',
  )
  const pkg = { name: 'test-course', private: true, homepage: 'https://example.invalid/test-course/', dependencies: { lysark: 'github:adamleon/lysark' } }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  writeFileSync(join(dir, '.vscode/settings.json'), JSON.stringify({ 'lysark.editorUrl': editorUrl }))
  return dir
}

function freePort() {
  return new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

/** VS Code for the web on `port`, with the extension from extension/, opened on `folder` */
async function startTestWeb(folder, port) {
  const windows = process.platform === 'win32'
  const args = ['--yes', TEST_WEB, '--extensionDevelopmentPath=.', '--browserType=none', `--port=${port}`, '--coi', windows ? `"${folder}"` : folder]
  const child = spawn('npx', args, { cwd: EXTENSION, shell: windows, detached: !windows })
  const stop = () => {
    running.delete(stop)
    try {
      // the whole tree: npx, and test-web under it
      if (windows) execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' })
      else process.kill(-child.pid)
    } catch {
      // already gone
    }
  }
  running.add(stop)
  let output = ''
  try {
    await new Promise((done, failed) => {
      const timer = setTimeout(() => failed(new Error(`VS Code for the web did not start:\n${output.slice(-2000)}`)), 300_000)
      const read = (chunk) => {
        output += chunk
        if (/Listening on http/.test(output)) {
          clearTimeout(timer)
          done()
        }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.on('exit', (code) => failed(new Error(`VS Code for the web exited (${code}):\n${output.slice(-2000)}`)))
    })
  } catch (err) {
    stop()
    throw err
  }
  return stop
}

/** test-web servers still running, stopped also when the check is interrupted (Ctrl+C) */
const running = new Set()
process.on('SIGINT', () => {
  for (const stop of [...running]) stop()
  process.exit(130)
})

/** the workbench steps; returns the lines of the report and whether all passed */
async function drive(page, protocol, lines) {
  let ok = true
  const check = (passed, what) => {
    lines.push(`${passed ? '✓' : '✗'} ${what}`)
    if (!passed) ok = false
  }
  const quickOpen = async (path) => {
    await page.keyboard.press('Control+P')
    await page.waitForSelector('.quick-input-widget input', { timeout: 10_000 })
    await page.keyboard.type(path, { delay: 10 })
    await page.waitForTimeout(1200)
    await page.keyboard.press('Enter')
  }
  const tab = (text) => page.locator('.tabs-container .tab', { hasText: text }).first()
  /** the deck's frame, once the deck runs (a panel loaded afresh has a new one) */
  const panelFrame = async (timeout = 60_000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      for (const f of page.frames()) {
        if (await f.evaluate(() => !!window.__lysark?.engine).catch(() => false)) return f
      }
      await page.waitForTimeout(500)
    }
    return null
  }
  /** the top of slides.md as the editor shows it (test-web keeps saves in its server, not on disk) */
  const editorTop = async () => {
    await tab('slides.md').click()
    await page.waitForTimeout(400)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(400)
    const rows = await page.$$eval('.editor-group-container.active .monaco-editor .view-line', (els) =>
      els.map((e) => ({ top: parseFloat(e.style.top), text: e.textContent.replace(/ /g, ' ') })),
    )
    return rows.sort((a, b) => a.top - b.top).slice(0, 12).map((r) => r.text)
  }
  const changedLines = (before, after) => after.filter((line, i) => line !== before[i])
  const camera = (frame) => frame.evaluate(() => JSON.stringify(window.__lysark.engine.current.effective.camera))
  /** turn the panel's camera, as dragging would, and save the view by V or through Scene Actions… */
  const saveView = async (frame, how) => {
    await frame.evaluate(() => {
      window.__lysark.sceneLayer.camera.position.x += 0.35
    })
    if (how === 'V') {
      await frame.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })))
    } else {
      await tab('Lysark').click()
      await page.waitForTimeout(500)
      await page.locator('[aria-label="Scene Actions…"]').first().click()
      await page.waitForSelector('.quick-input-widget .quick-input-list .monaco-list-row', { timeout: 10_000 })
      await page.keyboard.press('Enter') // the first action: save the view
    }
    await page.waitForTimeout(2500)
  }

  await page.waitForSelector('.monaco-workbench', { timeout: 120_000 })
  await page.waitForTimeout(4000)
  await quickOpen('lectures/demo/slides.md')
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('F1')
  await page.waitForSelector('.quick-input-widget input', { timeout: 10_000 })
  await page.keyboard.type('Open Lysark Preview', { delay: 10 })
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  // the workspace names the editor's address, so the extension asks first
  const load = page.locator('.monaco-dialog-box .monaco-button', { hasText: 'Load' })
  await load.waitFor({ timeout: 15_000 })
  await load.click()
  let frame = await panelFrame()
  check(!!frame, 'the preview started the deck')
  if (!frame) return false

  if (protocol >= 3) {
    const images = await frame.evaluate(() => Object.keys(window.__LYSARK_IMAGES__ ?? {}).sort())
    check(
      JSON.stringify(images) === JSON.stringify(['../../assets/dot.svg', 'images/two-link-arm.svg']),
      `images from the lecture folder and the course's assets/: ${JSON.stringify(images)}`,
    )
    await frame.evaluate(() => {
      window.__received = []
      window.addEventListener('message', (e) => window.__received.push(e.data))
    })
    // from the Explorer (Quick Open doesn't index files made after the start)
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: /^scenes$/ }).first().click()
    await page.waitForTimeout(800)
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'agilus.yaml' }).first().dblclick()
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+End')
    await page.keyboard.type('# touched\n')
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(2500)
    const sent = await frame.evaluate(() => window.__received.filter((m) => m?.type === 'lysark:source').map((m) => Object.keys(m.files)))
    check(
      sent.some((keys) => keys.includes('slides.md') && keys.includes('scenes/agilus.yaml')),
      `saving a scene file sends the lecture's files again: ${JSON.stringify(sent)}`,
    )
  }

  const start = await editorTop()
  await saveView(frame, 'V')
  const afterV = await editorTop()
  check(changedLines(start, afterV).length === 1, `V wrote the view into slides.md: ${JSON.stringify(changedLines(start, afterV))}`)
  frame = (await panelFrame()) ?? frame

  if (protocol >= 3) {
    await saveView(frame, 'actions')
    const afterActions = await editorTop()
    check(changedLines(afterV, afterActions).length === 1, `Scene Actions… wrote the view: ${JSON.stringify(changedLines(afterV, afterActions))}`)
    frame = (await panelFrame()) ?? frame
    const before = await camera(frame)
    await editorTop() // focus slides.md
    await page.keyboard.press('Control+Z')
    await page.waitForTimeout(4000)
    frame = (await panelFrame()) ?? frame
    const after = await camera(frame)
    check(before !== after, `undoing the saved view reached the panel: ${before} → ${after}`)
  } else {
    await tab('Lysark').click()
    await page.waitForTimeout(500)
    await page.locator('[aria-label="Scene Actions…"]').first().click()
    await page.waitForTimeout(800)
    const status = (await page.locator('.statusbar').textContent()) ?? ''
    check(/engine v2\.4\.0 or later/.test(status), 'Scene Actions… with an engine on messages version 2 says to update the engine')
  }
  return ok
}

async function checkExtension(editorDir) {
  const html = readFileSync(join(editorDir, 'index.html'), 'utf8')
  const protocol = editorProtocol(html)
  const lines = []
  const site = await serveEditor(editorDir)
  const course = makeCourse(`http://127.0.0.1:${site.address().port}${EDITOR_PREFIX}`)
  let stopTestWeb
  let browser
  let ok = false
  try {
    const port = await freePort()
    stopTestWeb = await startTestWeb(course, port)
    browser = await launchBrowser('chromium')
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(`http://localhost:${port}/`)
    ok = await drive(page, protocol, lines)
  } catch (err) {
    lines.push(`✗ check failed: ${String(err?.message ?? err).split('\n')[0]}`)
  } finally {
    await browser?.close()
    stopTestWeb?.()
    stopServer(site)
    rmSync(course, { recursive: true, force: true })
  }
  return { ok, protocol, lines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    console.error('Usage: node scripts/check-extension.mjs <editor dir> [<editor dir> …]')
    process.exit(1)
  }
  // always the current extension source
  execSync('node build.mjs', { cwd: EXTENSION, stdio: 'ignore' })
  let allOk = true
  for (const dir of dirs) {
    const started = Date.now()
    const report = await checkExtension(resolve(dir))
    console.log(`${report.ok ? '✓' : '✗'} extension with the editor in ${dir} (messages version ${report.protocol}, ${Math.round((Date.now() - started) / 1000)} s)`)
    for (const line of report.lines) console.log(`   ${line}`)
    allOk &&= report.ok
  }
  process.exit(allOk ? 0 : 1)
}
