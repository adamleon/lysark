// End-to-end check of the Lysark VS Code extension (docs/editor-host.md): the
// real extension in VS Code for the web (@vscode/test-web, cross-origin
// isolated like vscode.dev and github.dev), driven with Playwright, against an
// editor runtime served the way GitHub Pages serves it. For each editor
// folder it makes a small course from the demo lecture (an image in the
// lecture folder, one in the course's assets/, a scene file, and models in
// both), opens slides.md, opens the preview and, by the runtime's message version:
//
//   3  images shown from both folders, and with models (v2.13.0) models from
//      both folders shown in the scene; saving a scene file sends the files
//      again; V and Scene Actions… write the view into slides.md; undoing that
//      edit reaches the panel; and with an engine that has named views
//      (v2.5.0), V on a slide that names one writes it into the scene file,
//      and every slide that uses it takes it; with Save view as… (v2.6.0),
//      Shift+V makes a new view and scene file, and one Ctrl+Z undoes both;
//      with the joint sliders (v2.8.0), J and P change the pose a slide
//      names in the scene file, in place; with Save pose as… (v2.9.0),
//      Shift+P adds a new pose to a scene file and names it on the slide;
//      with the object handles (v2.12.0), dragging an object with M writes
//      its at into the scene file, in place
//   2  (engine v2.3.x) V writes the view; Scene Actions… says to update the engine
//
//   node scripts/check-extension.mjs <editor dir> [<editor dir> …]
//
// Not part of CI: the first run downloads VS Code Insiders (about 55 MB, into
// extension/.vscode-test-web), and the workbench's markup changes between
// Insiders builds. Run it before an extension release, with this engine's
// editor (`node bin/lysark.mjs editor-build`) and the previous release's.
import { execSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { launchBrowser } from './browser.mjs'
import { EDITOR_PREFIX, serveEditor, stopServer } from './editor-server.mjs'
import { editorProtocol } from '../src/editor/panel-page.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION = join(ROOT, 'extension')
const TEST_WEB = '@vscode/test-web@0.0.80'

/**
 * true if the editor build knows named views (engine v2.5.0): its compiler's
 * message for a misspelled one is in its files
 */
function knowsNamedViews(editorDir) {
  return buildSays(editorDir, 'a named view needs')
}

/** true if the editor build knows named poses (engine v2.7.0): the compiler's limits message is in its files */
function knowsPoses(editorDir) {
  return buildSays(editorDir, 'outside its limits')
}

/** true if the editor build knows objects in scene files (engine v2.11.0): the compiler's message for a ring of parents is in its files */
function knowsObjects(editorDir) {
  return buildSays(editorDir, 'hang on each other in a ring')
}

/**
 * Where a slide of the demo lecture is (0-based), by its id, so the checks
 * below go to the slide they mean when slides are added to the demo
 */
function demoSlide(id) {
  const ids = [...readFileSync(join(ROOT, 'lectures/demo/slides.md'), 'utf8').matchAll(/^id: *(\S+?) *\r?$/gm)].map((m) => m[1])
  const index = ids.indexOf(id)
  if (index < 0) throw new Error(`the demo lecture has no slide '${id}' (its slides: ${ids.join(', ')})`)
  return index
}

/** true if one of the editor build's scripts holds `text` */
function buildSays(editorDir, text) {
  const assets = join(editorDir, 'assets')
  return readdirSync(assets).some((f) => f.endsWith('.js') && readFileSync(join(assets, f), 'utf8').includes(text))
}

/** true if the editor build has the joint sliders and P (engine v2.8.0): the sliders' line about P is in its files */
function knowsPosePanel(editorDir) {
  return buildSays(editorDir, 'P: save this pose into slide')
}

/** true if the editor build has Save pose as… (engine v2.9.0): its dialog's title is in its files */
function knowsSavePoseAs(editorDir) {
  return buildSays(editorDir, "Save the robot's pose")
}

/** true if the editor build moves objects (engine v2.12.0): the objects' panel line is in its files */
function knowsObjectHandles(editorDir) {
  return buildSays(editorDir, 'Letting go writes the object')
}

/** true if the editor build shows models from files (engine v2.13.0): the compiler's message for a file type it can't show is in its files */
function knowsModels(editorDir) {
  return buildSays(editorDir, "isn't a file a lecture can show")
}

/** the demo's scene file comment that starts its models, which come last (lectures/demo/scenes/arm.yaml) */
const MODELS_MARK = /\r?\n[ \t]*# models \(from v2\.13\.0\)[\s\S]*$/

/** the model makeCourse adds from the course's assets/, by its path from the lecture folder */
const ASSETS_MODEL = '../../assets/bracket.stl'

/** the srcs of the demo lecture's models, as its scene file writes them */
function demoModels() {
  const objects = parseYaml(readFileSync(join(ROOT, 'lectures/demo/scenes/arm.yaml'), 'utf8')).objects ?? {}
  return Object.values(objects).flatMap((object) => (typeof object?.model === 'string' ? [object.model] : []))
}

/** true if the editor build has Save view as… (engine v2.6.0): its dialog's title is in its files */
function knowsSaveAs(editorDir) {
  const assets = join(editorDir, 'assets')
  return readdirSync(assets).some((f) => f.endsWith('.js') && readFileSync(join(assets, f), 'utf8').includes('Save this camera view'))
}

/**
 * The demo's slides.md with every `camera: <name>` written out as the view's
 * values, for an editor that doesn't know named views.
 */
function inlineViews(slides, sceneText) {
  const views = parseYaml(sceneText).views ?? {}
  return slides.replace(/^camera: *(\S[^\r\n]*?) *(?=\r?$)/gm, (line, name) => (views[name] ? `camera: ${JSON.stringify(views[name])}` : line))
}

/**
 * The demo's slides.md with every `joints: <name>` written out as the pose's
 * values, for an editor that doesn't know named poses (the demo's arm scene:
 * a list is joint1, joint2, joint3).
 */
function inlinePoses(slides, sceneText) {
  const poses = parseYaml(sceneText).poses ?? {}
  const asJoints = (pose) => (Array.isArray(pose) ? Object.fromEntries(pose.map((v, k) => [`joint${k + 1}`, v])) : pose)
  return slides.replace(/^joints: *(\S[^\r\n]*?) *(?=\r?$)/gm, (line, name) => (poses[name] ? `joints: ${JSON.stringify(asJoints(poses[name]))}` : line))
}

/** a course folder whose workspace settings point the extension at `editorUrl` */
function makeCourse(editorUrl, namedViews, poses, objects, models) {
  const dir = mkdtempSync(join(tmpdir(), 'lysark-course-'))
  const lecture = join(dir, 'lectures', 'demo')
  mkdirSync(join(lecture, 'scenes'), { recursive: true })
  mkdirSync(join(dir, 'assets'))
  mkdirSync(join(dir, '.vscode'))
  cpSync(join(ROOT, 'lectures/demo/images'), join(lecture, 'images'), { recursive: true })
  cpSync(join(ROOT, 'lectures/demo/models'), join(lecture, 'models'), { recursive: true })
  let arm = readFileSync(join(ROOT, 'lectures/demo/scenes/arm.yaml'), 'utf8')
  // objects come last in the file (their slide's anchors then warn, and the camera stays),
  // and the models last among them
  if (!objects) arm = arm.replace(/\r?\nobjects:[\s\S]*$/, '\n')
  else if (!models) {
    if (!MODELS_MARK.test(arm)) throw new Error("lectures/demo/scenes/arm.yaml has no '# models (from v2.13.0)' comment to leave its models out at")
    arm = arm.replace(MODELS_MARK, '\n')
  } else {
    // a model from the course's assets/ too: its bytes as they are (the extension reads any file's)
    writeFileSync(join(dir, 'assets/bracket.stl'), readFileSync(join(ROOT, 'lectures/demo/models/bracket.stl')))
    arm = `${arm.replace(/\s*$/, '\n')}  shelf bracket:\n    model: ${ASSETS_MODEL}\n    unit: mm\n    up: z\n    at: [0.12, 0.3, -0.12]\n    parent: table\n`
  }
  let slides = readFileSync(join(ROOT, 'lectures/demo/slides.md'), 'utf8')
  // what an older editor doesn't know is written out as numbers
  if (!poses) slides = inlinePoses(slides, arm)
  if (namedViews) writeFileSync(join(lecture, 'scenes/arm.yaml'), poses ? arm : arm.replace(/\r?\nposes:[\s\S]*$/, '\n'))
  else slides = inlineViews(slides, arm)
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
async function drive(page, protocol, namedViews, saveAs, posePanel, savePoseAs, objectHandles, models, lines) {
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
    if (models) {
      // models from both folders too, read through the extension as images are, and shown: each
      // model object of the first slide's scene (the arm's) is built with the file's meshes
      const shown = await frame
        .waitForFunction(() => {
          const L = window.__lysark
          if (L.sceneManager.busy || L.sceneManager.activeSceneId !== 'arm') return null
          const meshes = {}
          for (const [name, node] of Object.entries(L.sceneManager.active.anchors)) {
            const model = node.children.find((child) => child.name === `object:${name}:model`)
            if (!model) continue
            meshes[name] = 0
            model.traverse((part) => {
              if (part.isMesh) meshes[name] += 1
            })
          }
          return { files: Object.keys(window.__LYSARK_MODELS__ ?? {}).sort(), meshes }
        }, null, { timeout: 30_000 })
        .then((handle) => handle.jsonValue(), () => null)
      const expected = [...demoModels(), ASSETS_MODEL].sort()
      const built = Object.values(shown?.meshes ?? {})
      check(
        JSON.stringify(shown?.files) === JSON.stringify(expected) && built.length === expected.length && built.every((n) => n > 0),
        `models from the lecture folder and the course's assets/, shown in the scene: ${JSON.stringify(shown)}`,
      )
    } else lines.push('(models not checked: this editor has none)')
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

    if (!namedViews) lines.push('(named views not checked: this editor has none)')
    else {
      // the demo's slides 'pid-control' and 'control-loop', one after the other, name the
      // view 'overview' and the first the pose 'reach' (lectures/demo/scenes/arm.yaml); the
      // first pendulum slide's scene has no scene file; the KUKA slide's scene file has no poses
      const overview = demoSlide('pid-control')
      const pendulum = demoSlide('pendulum-cut')
      const kuka = demoSlide('agilus-joint')
      await frame.evaluate((n) => {
        location.hash = `#${n + 1}`
      }, overview)
      const settled = await frame
        .waitForFunction((n) => {
          const L = window.__lysark
          return L.engine.currentIndex === n && !L.sceneManager.busy && !L.cameraCtl.active
        }, overview, { timeout: 20_000 })
        .then(() => true, () => false)
      check(settled, `the panel went to slide ${overview + 1}, which names a view`)
      const cameras = () =>
        frame.evaluate((n) => window.__lysark.engine.opts.slides.slice(n, n + 2).map((s) => JSON.stringify(s.effective.camera)), overview)
      const old = await cameras()
      await saveView(frame, 'V')
      frame = (await panelFrame()) ?? frame
      const now = await cameras()
      check(
        now[0] !== old[0] && now[0] === now[1],
        `V on a slide that names a view saved it in scenes/arm.yaml, and both slides that name it took it: ${now[0]}`,
      )

      // Shift+V, Save view as… a new view on the demo's first pendulum slide,
      // whose scene has no scene file: one edit to slides.md that also creates
      // scenes/pendulum.yaml; undoing it takes both back
      if (!saveAs) {
        lines.push('(Save view as… not checked: this editor has none)')
        return ok
      }
      await frame.evaluate((n) => {
        window.__received = []
        window.addEventListener('message', (e) => window.__received.push(e.data))
        location.hash = `#${n + 1}`
      }, pendulum)
      const onPendulum = await frame
        .waitForFunction((n) => {
          const L = window.__lysark
          return L.engine.currentIndex === n && !L.sceneManager.busy && !L.cameraCtl.active && L.sceneManager.activeSceneId === 'pendulum'
        }, pendulum, { timeout: 20_000 })
        .then(() => true, () => false)
      check(onPendulum, `the panel went to slide ${pendulum + 1}, whose scene has no scene file`)
      await frame.evaluate(() => {
        window.__lysark.sceneLayer.camera.position.x += 0.3
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', shiftKey: true }))
      })
      const dialogInput = await frame
        .waitForSelector('[role="dialog"] input', { timeout: 10_000 })
        .then(() => true, () => false)
      check(dialogInput, 'Shift+V opened the Save view as… dialog')
      await frame.evaluate(() => {
        const input = document.querySelector('[role="dialog"] input')
        input.value = 'checked'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await page.waitForTimeout(3500)
      frame = (await panelFrame()) ?? frame
      const saved = await frame.evaluate((n) => ({
        camera: JSON.stringify(window.__lysark.engine.opts.slides[n].effective.camera),
        files: (window.__received ?? []).filter((m) => m?.type === 'lysark:source').map((m) => Object.keys(m.files)),
      }), pendulum)
      // the new file in the Explorer (its scenes/ folder is open from the step above)
      const pendulumFile = () => page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'pendulum.yaml' }).count()
      check(
        saved.files.some((keys) => keys.includes('scenes/pendulum.yaml')) && saved.camera !== undefined && (await pendulumFile()) > 0,
        `a new view saved by Shift+V created scenes/pendulum.yaml with slides.md, updating the panel in place; slide ${pendulum + 1} flies to it: ${saved.camera}`,
      )

      // undo it in slides.md: VS Code may ask whether to undo in both files
      await tab('slides.md').click()
      await page.waitForTimeout(400)
      await page.keyboard.press('Control+Z')
      const dialog = page.locator('.monaco-dialog-box')
      const asked = await dialog.isVisible({ timeout: 4000 }).catch(() => false)
      const question = asked ? ((await dialog.textContent()) ?? '').replace(/\s+/g, ' ').trim() : ''
      if (asked) await page.locator('.monaco-dialog-box .monaco-button').first().click()
      await page.waitForTimeout(4000)
      frame = (await panelFrame()) ?? frame
      const undoneCamera = await frame.evaluate((n) => JSON.stringify(window.__lysark.engine.opts.slides[n].effective.camera), pendulum)
      const fileLeft = await pendulumFile()
      check(
        undoneCamera !== saved.camera && fileLeft === 0,
        `undoing it in slides.md took both back: slide ${pendulum + 1}'s camera ${undoneCamera}, scenes/pendulum.yaml ${fileLeft === 0 ? 'gone' : 'still there'}` +
          (asked ? `; VS Code asked "${question.slice(0, 160)}" (first button taken)` : '; VS Code asked nothing'),
      )

      // J and P on the demo's slide 'pid-control', which names the pose 'reach'
      // (lectures/demo/scenes/arm.yaml): the slider moves the arm at once, and P
      // changes the pose in the scene file, which the panel takes in place
      if (!posePanel) {
        lines.push('(the joint sliders and P not checked: this editor has none)')
        return ok
      }
      await frame.evaluate((n) => {
        window.__received = []
        window.addEventListener('message', (e) => window.__received.push(e.data))
        location.hash = `#${n + 1}`
      }, overview)
      const onArm = await frame
        .waitForFunction((n) => {
          const L = window.__lysark
          return L.engine.currentIndex === n && !L.sceneManager.busy && L.sceneManager.activeSceneId === 'arm'
        }, overview, { timeout: 20_000 })
        .then(() => true, () => false)
      const jogged = await frame.evaluate(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
        const input = document.querySelector('[aria-label="Joint sliders"] input[aria-label="joint2"]')
        if (!input) return null
        input.focus() // as a drag does; P then goes to the slider
        input.value = '0.5'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return window.__lysark.sceneManager.active.channels.joint2.x
      })
      check(onArm && jogged === 0.5, `on slide ${overview + 1}, J showed the joint sliders and joint2's moved the arm at once: ${jogged}`)
      await frame.evaluate(() => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true })))
      await page.waitForTimeout(3500)
      const posed = await frame
        .evaluate((n) => ({
          // a panel loaded afresh would have lost what this page recorded
          inPlace: Array.isArray(window.__received),
          joints: window.__lysark.engine.opts.slides.slice(n, n + 2).map((s) => s.effective.joints.joint2),
          arm: (window.__received ?? []).filter((m) => m?.type === 'lysark:source').map((m) => m.files['scenes/arm.yaml']).pop() ?? '',
        }), overview)
        .catch(() => ({ inPlace: false, joints: [], arm: '' }))
      check(
        posed.inPlace && /reach: \[0\.9, 0\.5, -1\.5\]/.test(posed.arm) && posed.joints.every((q) => q === 0.5),
        `P changed the pose 'reach' in scenes/arm.yaml, in place; slides ${overview + 1} and ${overview + 2} take joint2 ${JSON.stringify(posed.joints)}`,
      )

      // Shift+P on the demo's KUKA slide 'agilus-joint': a new pose in scenes/agilus.yaml,
      // which has no poses yet, named on the slide; one edit to both files
      if (!savePoseAs) {
        lines.push('(Save pose as… not checked: this editor has none)')
        return ok
      }
      await frame.evaluate((n) => {
        window.__received = []
        location.hash = `#${n + 1}`
      }, kuka)
      const onKuka = await frame
        .waitForFunction((n) => {
          const L = window.__lysark
          return L.engine.currentIndex === n && !L.sceneManager.busy && L.sceneManager.activeSceneId === 'agilus'
        }, kuka, { timeout: 30_000 })
        .then(() => true, () => false)
      await frame.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', shiftKey: true, bubbles: true })))
      const poseDialog = await frame
        .waitForSelector('[role="dialog"] input', { timeout: 10_000 })
        .then(() => true, () => false)
      check(onKuka && poseDialog, `on slide ${kuka + 1}, Shift+P opened the Save pose as… dialog`)
      await frame.evaluate(() => {
        const input = document.querySelector('[role="dialog"] input')
        input.focus()
        input.value = 'grip'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await page.waitForTimeout(3500)
      const gripped = await frame
        .evaluate((n) => ({
          inPlace: Array.isArray(window.__received),
          joints: JSON.stringify(window.__lysark.engine.opts.slides[n].effective.joints),
          agilus: (window.__received ?? []).filter((m) => m?.type === 'lysark:source').map((m) => m.files['scenes/agilus.yaml']).pop() ?? '',
        }), kuka)
        .catch(() => ({ inPlace: false, joints: '', agilus: '' }))
      check(
        gripped.inPlace && /\n {2}grip: \[/.test(gripped.agilus) && /"joint_6"/.test(gripped.joints),
        `Shift+P saved a new pose 'grip' in scenes/agilus.yaml, in place; slide ${kuka + 1}'s joints ${gripped.joints}`,
      )

      // M on the demo's slide 'objects': dragging the table's ring writes its
      // new at into scenes/arm.yaml, and the panel takes it in place
      if (!objectHandles) {
        lines.push('(moving objects not checked: this editor has no M)')
        return ok
      }
      const objects = demoSlide('objects')
      await frame.evaluate((n) => {
        window.__received = []
        location.hash = `#${n + 1}`
      }, objects)
      const onObjects = await frame
        .waitForFunction((n) => {
          const L = window.__lysark
          return L.engine.currentIndex === n && !L.sceneManager.busy && L.sceneManager.activeSceneId === 'arm' && !L.cameraCtl.active
        }, objects, { timeout: 30_000 })
        .then(() => true, () => false)
      await frame.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true })))
      const ring = await frame
        .waitForFunction(() => {
          const el = document.querySelector('.lysark-object-handle[data-object="table"]')
          if (!el || el.style.display === 'none') return null
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }, null, { timeout: 10_000 })
        .then((handle) => handle.jsonValue(), () => null)
      check(onObjects && ring !== null, `on slide ${objects + 1}, M showed a ring on the table`)
      if (ring) {
        // as a mouse drags it (the page can't capture a pointer it made up: the window hears the moves)
        await frame.evaluate((p) => {
          const event = (type, x, y) =>
            new PointerEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse', pointerId: 5, clientX: x, clientY: y, bubbles: true })
          document.querySelector('.lysark-object-handle[data-object="table"]').dispatchEvent(event('pointerdown', p.x, p.y))
          for (let k = 1; k <= 6; k++) window.dispatchEvent(event('pointermove', p.x - 7 * k, p.y + 2 * k))
          window.dispatchEvent(event('pointerup', p.x - 42, p.y + 12))
        }, ring)
        await page.waitForTimeout(3500)
      }
      const moved = await frame
        .evaluate(() => {
          const table = window.__lysark.sceneManager.active.anchors.table.position
          return {
            inPlace: Array.isArray(window.__received),
            node: [table.x, table.y, table.z],
            arm: (window.__received ?? []).filter((m) => m?.type === 'lysark:source').map((m) => m.files['scenes/arm.yaml']).pop() ?? '',
          }
        })
        .catch(() => ({ inPlace: false, node: [], arm: '' }))
      const written = moved.arm ? parseYaml(moved.arm).objects?.table?.at : undefined
      check(
        moved.inPlace && Array.isArray(written) && written.every((v, k) => Math.abs(v - moved.node[k]) < 1e-9) && !/at: \[0\.62, 0, -0\.69\]/.test(moved.arm),
        `dragging the table wrote at ${JSON.stringify(written)} into scenes/arm.yaml, and the panel took it in place`,
      )
    }
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
  const namedViews = knowsNamedViews(editorDir)
  const poses = knowsPoses(editorDir)
  const objects = knowsObjects(editorDir)
  const models = knowsModels(editorDir)
  const course = makeCourse(`http://127.0.0.1:${site.address().port}${EDITOR_PREFIX}`, namedViews, poses, objects, models)
  let stopTestWeb
  let browser
  let ok = false
  try {
    const port = await freePort()
    stopTestWeb = await startTestWeb(course, port)
    browser = await launchBrowser('chromium')
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(`http://localhost:${port}/`)
    ok = await drive(page, protocol, namedViews, knowsSaveAs(editorDir), knowsPosePanel(editorDir), knowsSavePoseAs(editorDir), knowsObjectHandles(editorDir), models, lines)
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
