import * as vscode from 'vscode'
import { slideAtLine, slideRanges } from '../../src/compiler/slide-ranges'
import { setCameraView, type CameraView } from '../../src/editor/camera-edit'
import { EDITOR_PROTOCOL, editorAssets, editorProtocol, messagePage, panelPage } from '../../src/editor/panel-page.js'
import {
  bytesToBase64,
  editorUrl,
  fileProblem,
  includePatterns,
  isCameraView,
  isCoursePackage,
  isCreatablePath,
  isWritablePath,
  matchSlide,
  notificationText,
  resolveInside,
  singleEdit,
} from './logic'

/**
 * The Lysark VS Code extension (lysark-v2.md §5, step 3). It is a thin host:
 * the panel's page loads the editor runtime's files from the course's own
 * GitHub Pages site (built from the engine version the course uses), and the
 * extension sends it the lecture's files. With messages version 3 (engine
 * v2.4.0) the editing happens in the panel too: the extension reads files,
 * lists folders, applies edits and asks questions when the panel asks, within
 * limits on which files (docs/editor-host.md). With version 2 (engine v2.3.x)
 * the extension writes saved views itself. It runs in desktop VS Code,
 * vscode.dev and github.dev alike, so it uses only the vscode API and fetch.
 */

/** the message versions this extension speaks */
const PROTOCOLS = [2, EDITOR_PROTOCOL]
/** a panel that hasn't said 'ready' by then gets a warning */
const READY_TIMEOUT_MS = 30_000
/** reading the site's editor page gives up after this */
const FETCH_TIMEOUT_MS = 15_000
/** limits on what the panel may ask for at once */
const MAX_READ_FILES = 64
const MAX_READ_BYTES = 32_000_000
const MAX_READ_TOTAL = 64_000_000
const MAX_CHANGES = 16
/** limits on the files sent with every update (the include patterns) */
const MAX_INCLUDED_FILES = 64
const MAX_INCLUDED_BYTES = 1_000_000
/** edits the panel made, kept so undoing one shows in the panel */
const PANEL_EDITS_KEPT = 20
/** numbered sets of files kept besides those in use */
const TEXTS_KEPT = 16
/** the preview may ask a question this long after you click one of its buttons (or answer one) */
const ASK_WINDOW_MS = 10_000

// Every notification goes through these: VS Code turns `[label](command:…)` in
// an extension's message into a link that runs the command, and messages here
// can carry text from the workspace or the course site.
const showError = (text: string, ...actions: string[]) => vscode.window.showErrorMessage(notificationText(text), ...actions)
const showWarning = (text: string, ...actions: string[]) =>
  vscode.window.showWarningMessage(notificationText(text), ...actions)

export function activate(context: vscode.ExtensionContext): void {
  // one preview at a time, like the deck's one live scene (lysark-design.md §4.1):
  // previewing another lecture replaces it
  let preview: Preview | null = null
  context.subscriptions.push(
    // the camera button on the preview's title bar does what V does in the preview
    vscode.commands.registerCommand('lysark.saveView', () => preview?.requestView()),
    vscode.commands.registerCommand('lysark.sceneActions', () => preview?.requestActions()),
    vscode.commands.registerCommand('lysark.openPreview', async (uri?: vscode.Uri) => {
      const document = uri
        ? await vscode.workspace.openTextDocument(uri)
        : vscode.window.activeTextEditor?.document
      // only a lecture's slides.md: the panel may read the files in its folder
      if (!document || document.uri.path.split('/').pop() !== 'slides.md') {
        void showError('Lysark: open a lecture’s slides.md first.')
        return
      }
      if (preview?.document === document) {
        // ▷ again: show the current text, or load the panel afresh (and retry
        // a preview that didn't load)
        preview.panel.reveal(vscode.ViewColumn.Beside, true)
        preview.refresh(true)
        return
      }
      let site: { url: string; fromWorkspace: boolean; courseDir: vscode.Uri | null }
      try {
        site = await runtimeUrl(document.uri)
      } catch (err) {
        void showError(`Lysark: ${(err as Error).message}`)
        return
      }
      // the panel may read the files in the lecture's folder: only a lecture's own folder
      if (!site.courseDir) {
        void showError('Lysark: this file is not inside a Lysark course (no package.json that depends on lysark was found above it).')
        return
      }
      if (vscode.Uri.joinPath(document.uri, '..').toString() === site.courseDir.toString()) {
        void showError('Lysark: this slides.md is at the top of the course; a lecture’s slides.md is in its own folder.')
        return
      }
      if (site.fromWorkspace && !(await confirmSite(context, site.url))) return
      preview?.panel.dispose()
      const opened: Preview = new Preview(document, site.url, site.courseDir, () => {
        if (preview === opened) preview = null
      })
      preview = opened
    }),
    { dispose: () => preview?.panel.dispose() },
  )
}

export function deactivate(): void {}

/**
 * The editor runtime's address, from the setting or the course's package.json.
 * `fromWorkspace`: the repository chose it (its package.json, or its own
 * settings), not the user. `courseDir`: the course's folder, if found, whose
 * assets/ folder the panel may read images from.
 */
async function runtimeUrl(slidesUri: vscode.Uri): Promise<{ url: string; fromWorkspace: boolean; courseDir: vscode.Uri | null }> {
  const course = await findCoursePackage(slidesUri)
  const config = vscode.workspace.getConfiguration('lysark')
  const setting = config.get<string>('editorUrl') ?? ''
  if (setting.trim()) {
    const where = config.inspect<string>('editorUrl')
    return {
      url: editorUrl(setting, null),
      fromWorkspace: !!(where?.workspaceValue || where?.workspaceFolderValue),
      courseDir: course?.dir ?? null,
    }
  }
  if (!course) {
    throw new Error('this file is not inside a Lysark course (no package.json that depends on lysark was found above it).')
  }
  return { url: editorUrl('', course.json), fromWorkspace: true, courseDir: course.dir }
}

const CONFIRMED_SITES = 'lysark.confirmedSites'

/**
 * The panel runs the editor's scripts from the site a repository names. Ask
 * once per site before doing that for a repository's choice (the answer is
 * kept in this browser or VS Code), so opening a stranger's repository and
 * clicking ▷ doesn't silently run its site's code.
 */
async function confirmSite(context: vscode.ExtensionContext, url: string): Promise<boolean> {
  const host = new URL(url).host
  const confirmed = context.globalState.get<string[]>(CONFIRMED_SITES, [])
  if (confirmed.includes(host)) return true
  const choice = await vscode.window.showWarningMessage(
    notificationText(
      `Lysark: the preview runs the course's editor from ${host}, the site this repository names. ` +
        'Load it only if you trust this course.',
    ),
    { modal: true },
    'Load',
  )
  if (choice !== 'Load') return false
  await context.globalState.update(CONFIRMED_SITES, [...confirmed, host])
  return true
}

/** the nearest package.json above the file that belongs to a Lysark course, and its folder */
async function findCoursePackage(file: vscode.Uri): Promise<{ json: unknown; dir: vscode.Uri } | null> {
  const root = vscode.workspace.getWorkspaceFolder(file)?.uri
  let dir = vscode.Uri.joinPath(file, '..')
  for (let depth = 0; depth < 20; depth++) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, 'package.json'))
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (isCoursePackage(json)) return { json, dir }
    } catch {
      // no package.json here, or not JSON: keep looking upward
    }
    if (root && dir.toString() === root.toString()) break
    const parent = vscode.Uri.joinPath(dir, '..')
    if (parent.toString() === dir.toString()) break
    dir = parent
  }
  return null
}

/** a file as the panel gets it (src/editor/host.ts) */
interface HostFile {
  text?: string
  version?: number
  base64?: string
  error?: string
  /** not read in this request (it would have been too large together): ask again */
  later?: boolean
}

type HostRequest =
  | { type: 'lysark:read'; id: number; paths?: unknown; as?: unknown }
  | { type: 'lysark:list'; id: number; dir?: unknown }
  | { type: 'lysark:edit'; id: number; label?: unknown; changes?: unknown }
  | { type: 'lysark:ask'; id: number; title?: unknown; items?: unknown; input?: unknown }

type FromRuntime =
  | { type: 'lysark:ready'; protocol?: unknown; render?: number; include?: unknown }
  | { type: 'lysark:shown'; seq: number; index?: number }
  | { type: 'lysark:accepted'; seq: number }
  | { type: 'lysark:slide'; index: number; seq: number | null }
  | { type: 'lysark:save-view'; slide: number; seq: number | null; view: unknown }
  | { type: 'lysark:error'; message: string; seq?: number; fatal?: boolean }
  | HostRequest

/** the lecture's files as sent to the panel, by path relative to the lecture folder; slides.md first */
type Files = Record<string, string>

const isInt = (n: unknown): n is number => Number.isInteger(n)

/**
 * One preview panel. Every set of files it sends is numbered (seq) and kept
 * until the runtime has moved past it: slide numbers from the runtime count
 * the slides of the text it shows, which can differ from the document, through
 * unsaved edits or a save the runtime refused because the text had an error.
 * matchSlide translates between the two.
 */
class Preview {
  readonly panel: vscode.WebviewPanel
  private readonly lectureDir: vscode.Uri
  /** the message version of the site's runtime, read with its page */
  private protocol = EDITOR_PROTOCOL
  /** the files besides slides.md the page asked for in 'ready' (version 3) */
  private include = includePatterns([])
  private includeKey = '[]'
  /** the slide the runtime shows, counted in the text it shows */
  private slide = 0
  private seq = 0
  private readonly texts = new Map<number, Files>()
  /** the last text sent, the last one the runtime accepted, and the one it shows */
  private latest: number | null = null
  private accepted: number | null = null
  private shown: number | null = null
  /** the text a fresh page is starting with, from its 'ready' until its 'shown' */
  private booting: number | null = null
  /** reading and numbering the files, one at a time */
  private queue: Promise<void> = Promise.resolve()
  private readonly disposables: vscode.Disposable[] = []
  /** panel pages shown so far; the runtime names its page's number in 'ready' */
  private renders = 0
  /** each render() call; a newer one supersedes an older one still fetching */
  private attempts = 0
  /**
   * the page has said 'ready' for the current render. Until then nothing is
   * sent: VS Code drops or rushes messages sent while it swaps the page in, and
   * 'ready' sends everything that matters again.
   */
  private pageReady = false
  /** the last render failed, its page never said 'ready', or it failed to start: worth trying again */
  private renderFailed = false
  private readyTimedOut = false
  /** some page of this preview has said 'ready', so there is a working one to keep */
  private everReady = false
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  /** the lecture files being saved with Ctrl+S, from onWillSave to onDidSave */
  private readonly manualSaves = new Set<string>()
  /**
   * the text of each file before and after the panel's recent edits: an undo
   * from `after` to `before` (or a redo back) undid or redid the panel's edit,
   * which then shows in the panel at once, as the edit did
   */
  private readonly panelEdits: Array<{ uri: string; before: string; after: string }> = []
  /** each lecture file's text after its last change, to tell where an undo came from */
  private readonly lastText = new Map<string, string>()
  /** the panel's file reads, one request at a time (each can be large) */
  private reads: Promise<unknown> = Promise.resolve()
  /** the panel's edits, one at a time */
  private edits: Promise<unknown> = Promise.resolve()
  /** until when the preview may ask a question, and whether one is showing */
  private askUntil = 0
  private asking = false
  /** the images the current page asked for (found or not), so a change to one loads it afresh */
  private pageImages = new Set<string>()
  /** a number per open document, so a document closed and opened again can't repeat a version */
  private readonly epochs = new WeakMap<vscode.TextDocument, number>()
  private nextEpoch = 1
  private disposed = false

  constructor(
    readonly document: vscode.TextDocument,
    /** the editor's folder on the course site; follows a redirect (say, to a custom domain) */
    private base: string,
    /** the course's folder, if found: the panel may read its assets/ */
    private readonly courseDir: vscode.Uri | null,
    onClose: () => void,
  ) {
    this.lectureDir = vscode.Uri.joinPath(document.uri, '..')
    const folder = document.uri.path.split('/').slice(-2, -1)[0] ?? 'slides'
    this.panel = vscode.window.createWebviewPanel(
      'lysark.preview',
      `Lysark: ${folder}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      // keep the 3D scene alive while the tab is in the background; the panel
      // loads nothing from the workspace, and a form in a lecture can't replace it
      { enableScripts: true, enableForms: false, retainContextWhenHidden: true, localResourceRoots: [] },
    )
    void this.render()

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: FromRuntime) => this.onMessage(m)),
      // new text reaches the preview when you save (Ctrl+S) slides.md or a file
      // the page includes, so typing doesn't reload it. Auto-save, on by default
      // in the browser versions, would reload the panel at every pause, so it
      // doesn't count.
      vscode.workspace.onWillSaveTextDocument((e) => {
        const key = e.document.uri.toString()
        if (e.reason === vscode.TextDocumentSaveReason.Manual && this.isLectureFile(e.document.uri)) this.manualSaves.add(key)
        else this.manualSaves.delete(key)
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (!this.manualSaves.delete(d.uri.toString())) return
        // saving another lecture file (a scene file) keeps slides.md as last
        // sent: its unsaved typing waits for its own Ctrl+S
        if (d === this.document) this.refresh()
        else this.sendDocument('last')
      }),
      // undoing (or redoing) an edit the panel made shows in the panel at once,
      // as the edit did; undoing ordinary typing waits for Ctrl+S, like typing
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.isLectureFile(e.document.uri)) return
        const key = e.document.uri.toString()
        const text = e.document.getText()
        const previous = this.lastText.get(key)
        this.lastText.set(key, text)
        const across =
          e.reason === vscode.TextDocumentChangeReason.Undo
            ? (p: { before: string; after: string }) => previous === p.after && text === p.before
            : e.reason === vscode.TextDocumentChangeReason.Redo
              ? (p: { before: string; after: string }) => previous === p.before && text === p.after
              : null
        if (across && this.panelEdits.some((p) => p.uri === key && across(p))) {
          this.sendDocument(e.document === this.document ? 'live' : 'last')
        }
      }),
      // files created, deleted or renamed in VS Code (also by the panel's own
      // edits): a file the page includes, or an image the panel shows
      vscode.workspace.onDidCreateFiles((e) => this.filesChanged(e.files)),
      vscode.workspace.onDidDeleteFiles((e) => this.filesChanged(e.files)),
      vscode.workspace.onDidRenameFiles((e) => this.filesChanged(e.files.flatMap((f) => [f.oldUri, f.newUri]))),
      // moving the cursor to another slide shows that slide: by keyboard, mouse,
      // or a command such as Go to Line or a search result. An edit, such as a
      // saved view, also moves it, with no kind; that doesn't count.
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.kind !== undefined && e.textEditor.document === this.document) this.followCursor(e.selections[0].active.line)
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d === this.document) this.panel.dispose()
      }),
    )
    this.panel.onDidDispose(() => {
      this.disposed = true
      clearTimeout(this.readyTimer)
      for (const d of this.disposables) d.dispose()
      onClose()
    })
  }

  /** the preview failed to load or to start, so opening or saving should try again */
  get stalled(): boolean {
    return this.renderFailed || this.readyTimedOut
  }

  retry(): void {
    void this.render()
  }

  /**
   * Show the lecture's current files, and retry a preview that didn't load.
   * `reload` (▷): if the files haven't changed, load a version 3 panel afresh
   * anyway, which reads the images again.
   */
  refresh(reload = false): void {
    if (this.stalled) {
      this.sendDocument('live')
      this.retry()
      return
    }
    void this.queued(async () => {
      if (!(await this.update('live')) && reload && this.protocol >= 3 && this.everReady && !this.disposed) void this.render()
    })
  }

  /** a notification's Retry: only if the preview still needs it, not after it recovered */
  private async offerRetry(shown: Thenable<string | undefined>): Promise<void> {
    if ((await shown) === 'Retry' && !this.disposed && this.stalled) this.retry()
  }

  requestView(): void {
    if (!this.pageReady) {
      vscode.window.setStatusBarMessage('$(sync~spin) Lysark: the preview is still loading', 3000)
      return
    }
    this.askUntil = Date.now() + ASK_WINDOW_MS
    this.post({ type: 'lysark:request-view' })
  }

  requestActions(): void {
    if (!this.pageReady) vscode.window.setStatusBarMessage('$(sync~spin) Lysark: the preview is still loading', 3000)
    else if (this.protocol < 3) {
      vscode.window.setStatusBarMessage("$(info) Lysark: scene actions need the course's engine v2.4.0 or later (Update engine)", 6000)
    } else {
      this.askUntil = Date.now() + ASK_WINDOW_MS
      this.post({ type: 'lysark:request-actions' })
    }
  }

  /**
   * Load the panel page afresh. The site's editor page is read each time for
   * the runtime's file names (a redeploy of the course site renames them) and
   * the message version it speaks.
   */
  private async render(): Promise<void> {
    const attempt = ++this.attempts
    let base = this.base
    if (!this.everReady) this.panel.webview.html = messagePage(`Loading the Lysark editor from ${new URL(base).host}…`)
    let assets: { scripts: string[]; styles: string[] }
    let protocol: number
    try {
      // the query skips cached copies (Pages lets browsers keep pages 10 minutes)
      const response = await fetch(`${base}index.html?t=${Date.now()}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (response.redirected) {
        // a moved folder on the same site is followed; another site is not
        // (the site the user confirmed is the one that runs)
        const moved = new URL('.', response.url)
        if (moved.host !== new URL(base).host || /[\s;,'"]/.test(moved.href)) {
          throw new Error(`the site redirects to ${moved.href}. Set "homepage" in package.json to the address it redirects to`)
        }
        base = moved.href
      }
      const html = await response.text()
      const stated = editorProtocol(html)
      if (stated === null || !PROTOCOLS.includes(stated)) {
        throw new Error(
          stated === null || stated < PROTOCOLS[0]
            ? "the course's engine is older than this extension. Run Update engine in the course repo (engine v2.3.0 or later)"
            : "this extension is older than the course's engine. Update the Lysark extension",
        )
      }
      protocol = stated
      assets = editorAssets(html, base)
    } catch (err) {
      if (attempt !== this.attempts || this.disposed) return
      this.renderFailed = true
      const error = err as Error
      const why =
        error.name === 'TimeoutError'
          ? 'no answer in time'
          : error instanceof TypeError
            ? // what a browser says for no network, and for a redirect to another site
              `${error.message}. You may be offline; or, if the course has its own domain, set "homepage" in package.json to it`
            : error.message
      if (!this.everReady) {
        this.panel.webview.html = messagePage(`Could not load the Lysark editor from ${base}: ${why}.`)
        void this.offerRetry(showError(`Lysark: could not load the editor from ${base}: ${why}.`, 'Retry'))
      } else {
        // keep the page that works rather than load files that may be gone
        void this.offerRetry(showWarning(`Lysark: the preview was not updated (${base}: ${why}).`, 'Retry'))
      }
      return
    }
    if (attempt !== this.attempts || this.disposed) return
    this.base = base
    this.protocol = protocol
    this.renders += 1
    this.pageImages = new Set()
    this.renderFailed = false
    this.readyTimedOut = false
    this.pageReady = false
    this.booting = null
    this.panel.webview.html = panelPage({ base, ...assets, render: this.renders })
    clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => {
      this.readyTimedOut = true
      void this.offerRetry(
        showWarning(
          `Lysark: the preview hasn't started. Check that ${base} opens in a browser. Firefox needs version 140 or ` +
            'later for private windows, and must not block all third-party cookies.',
          'Retry',
        ),
      )
    }, READY_TIMEOUT_MS)
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }

  private textOf(seq: number | null | undefined): string | undefined {
    return typeof seq === 'number' ? this.texts.get(seq)?.['slides.md'] : undefined
  }

  /** send files `seq`, asking for the slide shown now, found in that text; returns that slide */
  private send(seq: number): number {
    const files = this.texts.get(seq)!
    const text = files['slides.md']
    const showing = this.textOf(this.shown)
    const found = showing === undefined ? this.slide : matchSlide(showing, text, this.slide)
    const slide = found >= 0 ? found : this.slide
    if (this.protocol >= 3) this.post({ type: 'lysark:source', files, seq, slide, protocol: this.protocol })
    else this.post({ type: 'lysark:source', text, seq, slide, protocol: this.protocol })
    return slide
  }

  /** run after the reads and sends before it, so files are numbered in the order they were read */
  private queued(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work).catch((err) => {
      vscode.window.setStatusBarMessage(`$(warning) Lysark: ${notificationText(String((err as Error)?.message ?? err))}`, 8000)
    })
    return this.queue
  }

  /** number the lecture's files as the latest */
  private record(files: Files): void {
    // a file that hasn't changed shares the last set's string, so keeping
    // many sets costs little
    const last = this.latest === null ? undefined : this.texts.get(this.latest)
    for (const key of Object.keys(files)) if (last?.[key] === files[key]) files[key] = last[key]
    this.seq += 1
    this.texts.set(this.seq, files)
    this.latest = this.seq
    // a page that never answers mustn't make the sets pile up: keep the ones in use and the newest
    const inUse = new Set([this.shown, this.accepted, this.booting, this.latest])
    const old = [...this.texts.keys()].filter((seq) => !inUse.has(seq))
    for (const seq of old.slice(0, Math.max(0, old.length - TEXTS_KEPT))) this.texts.delete(seq)
  }

  /**
   * Send the lecture's files, if they differ from the last ones sent. `live`:
   * slides.md as it is now, unsaved typing included (its Ctrl+S, ▷, an edit to
   * it). `last`: slides.md as last sent, with the other files as they are now
   * (a scene file saved or edited, files created or deleted), so typing in
   * slides.md still waits for its own Ctrl+S.
   */
  private sendDocument(slides: 'live' | 'last'): void {
    void this.queued(async () => {
      await this.update(slides)
    })
  }

  /** (run queued) number the lecture's files and send them, if they differ from the latest; true if they did */
  private async update(slides: 'live' | 'last'): Promise<boolean> {
    // chosen now, when it runs, not when it was queued: an update queued before it may have sent newer text
    const files = await this.gather(slides === 'last' ? this.textOf(this.latest) : undefined)
    if (this.disposed) return false
    const last = this.latest === null ? undefined : this.texts.get(this.latest)
    if (last && JSON.stringify(last) === JSON.stringify(files)) return false
    this.record(files)
    // while a page loads, its 'ready' sends the latest files
    if (this.pageReady) this.send(this.seq)
    return true
  }

  /**
   * The lecture's files for the panel, as VS Code has them (unsaved typing
   * included): slides.md, or `slides` instead of its current text; and with
   * version 3, the files the page includes (plain files only, up to a limit).
   */
  private async gather(slides = this.document.getText()): Promise<Files> {
    const files: Files = { 'slides.md': slides }
    if (this.protocol < 3) return files
    let count = 0
    for (const dir of this.include.dirs) {
      const folder = vscode.Uri.joinPath(this.lectureDir, dir)
      let entries: [string, vscode.FileType][]
      try {
        if (!(await this.noLinks(folder))) continue
        entries = await vscode.workspace.fs.readDirectory(folder)
      } catch {
        continue // no such folder
      }
      // a link is File | SymbolicLink, so it isn't taken: it could lead out of the lecture folder
      const names = entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name)
      for (const name of names.sort()) {
        const rel = `${dir}/${name}`
        if (!this.include.matches(rel) || count >= MAX_INCLUDED_FILES) continue
        const uri = vscode.Uri.joinPath(folder, name)
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
        try {
          const text = open
            ? open.getText()
            : (await vscode.workspace.fs.stat(uri)).size <= MAX_INCLUDED_BYTES
              ? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
              : null
          if (text === null || text.length > MAX_INCLUDED_BYTES) continue
          files[rel] = text
          count += 1
        } catch {
          // deleted meanwhile
        }
      }
    }
    return files
  }

  /** slides.md, or a file the page includes */
  private isLectureFile(uri: vscode.Uri): boolean {
    if (uri.toString() === this.document.uri.toString()) return true
    const rel = this.relative(uri)
    return rel !== null && this.include.matches(rel)
  }

  /** the path of `uri` relative to the lecture folder, or null if it is not inside it */
  private relative(uri: vscode.Uri): string | null {
    const dir = this.lectureDir
    if (uri.scheme !== dir.scheme || uri.authority !== dir.authority || !uri.path.startsWith(`${dir.path}/`)) return null
    return uri.path.slice(dir.path.length + 1)
  }

  /** the course's assets/ folder as a path, if the course is known */
  private get assetsPath(): string | null {
    return this.courseDir ? vscode.Uri.joinPath(this.courseDir, 'assets').path : null
  }

  /**
   * true unless the way from the lecture folder (or from the course folder,
   * its assets/ folder included) to `uri` passes a link. The path rules check
   * only a path's text, and a link in the lecture folder could lead anywhere
   * on the computer (only desktop VS Code has links). A part that doesn't
   * exist (yet) ends the check: nothing past it can be a link.
   */
  private async noLinks(uri: vscode.Uri): Promise<boolean> {
    const lecture = this.lectureDir.path
    const assets = this.assetsPath
    let root: string
    if (uri.path === lecture || uri.path.startsWith(`${lecture}/`)) root = lecture
    else if (assets && (uri.path === assets || uri.path.startsWith(`${assets}/`))) root = assets.slice(0, assets.lastIndexOf('/'))
    else return false
    let path = root
    for (const part of uri.path.slice(root.length).split('/').filter(Boolean)) {
      path += `/${part}`
      let stat: vscode.FileStat
      try {
        stat = await vscode.workspace.fs.stat(uri.with({ path }))
      } catch {
        return true
      }
      if (stat.type & vscode.FileType.SymbolicLink) return false
    }
    return true
  }

  /**
   * Files created, deleted or renamed in VS Code. A file the page includes (or
   * its whole folder): send the files again, with slides.md as last sent, so
   * unsaved typing still waits for Ctrl+S. An image the page asked for, found
   * or not (or a folder it is in): load the panel afresh, since the panel reads
   * its images when it starts.
   */
  private filesChanged(uris: readonly vscode.Uri[]): void {
    if (this.protocol < 3) return
    const included = (uri: vscode.Uri) => {
      const rel = this.relative(uri)
      return rel !== null && (this.include.matches(rel) || this.include.dirs.includes(rel))
    }
    if (uris.some(included)) this.sendDocument('last')
    const image = (uri: vscode.Uri) => {
      const key = uri.with({ query: '', fragment: '' }).toString()
      return [...this.pageImages].some((asked) => asked === key || asked.startsWith(`${key}/`))
    }
    if (this.renders > 0 && uris.some(image)) {
      void this.queued(async () => {
        if (!this.disposed) void this.render()
      })
    }
  }

  /** forget texts the runtime has moved past */
  private prune(): void {
    const needed = [this.shown, this.accepted, this.latest, this.booting].filter((s): s is number => s !== null)
    const oldest = Math.min(...needed)
    for (const seq of [...this.texts.keys()]) if (seq < oldest) this.texts.delete(seq)
  }

  private followCursor(line: number): void {
    const text = this.document.getText()
    let index: number
    try {
      index = slideAtLine(slideRanges(text), line)
    } catch {
      return // the text doesn't split into slides right now; the preview says why on save
    }
    // counted in the text the panel shows, or is starting with
    const showing = this.textOf(this.booting ?? this.shown)
    const target = index < 0 || showing === undefined ? index : matchSlide(text, showing, index)
    // -1: a slide the preview doesn't have yet (new or edited, not saved)
    if (target >= 0 && target !== this.slide) {
      this.slide = target
      // a page still loading starts on this slide anyway ('source' names it)
      if (this.pageReady) this.post({ type: 'lysark:goto', slide: target })
    }
  }

  private onMessage(message: FromRuntime): void {
    switch (message?.type) {
      case 'lysark:ready':
        void this.onReady(message)
        break
      case 'lysark:shown':
        if (this.texts.has(message.seq)) {
          this.shown = message.seq
          this.booting = null
          this.everReady = true
          if (Number.isInteger(message.index)) this.slide = message.index!
          this.accepted = Math.max(this.accepted ?? message.seq, message.seq)
          this.prune()
        }
        break
      case 'lysark:accepted':
        // the text compiles: load the panel afresh, and its 'ready' gets the text
        if (this.texts.has(message.seq)) {
          this.accepted = Math.max(this.accepted ?? message.seq, message.seq)
          this.prune()
          void this.render()
        }
        break
      case 'lysark:slide':
        if (Number.isInteger(message.index) && message.seq !== null && this.texts.has(message.seq)) {
          this.shown = message.seq
          this.slide = message.index
        }
        break
      case 'lysark:save-view':
        // version 2: the extension writes the view
        if (this.protocol === 2 && Number.isInteger(message.slide) && message.slide >= 0 && isCameraView(message.view)) {
          void this.saveView(message.slide, this.textOf(message.seq), message.view)
        }
        break
      case 'lysark:error': {
        const first = String(message.message).split('\n')[0]
        if (message.fatal) {
          // the deck itself failed to start (its files didn't load): the panel
          // needs loading afresh, which ▷, a save, or Retry does
          this.renderFailed = true
          void this.offerRetry(showWarning(`Lysark: the preview failed to start: ${first}`, 'Retry'))
        } else {
          vscode.window.setStatusBarMessage(`$(warning) Lysark: ${notificationText(first)}`, 8000)
        }
        break
      }
      case 'lysark:read':
      case 'lysark:list':
      case 'lysark:edit':
      case 'lysark:ask':
        if (this.protocol >= 3 && isInt(message.id)) void this.answer(message)
        break
    }
  }

  private async onReady(message: Extract<FromRuntime, { type: 'lysark:ready' }>): Promise<void> {
    // a late 'ready' from the page the current one replaced
    if (message.render !== this.renders) return
    clearTimeout(this.readyTimer)
    this.readyTimedOut = false
    if (message.protocol !== this.protocol) {
      const theirs = Number.isInteger(message.protocol) ? message.protocol : 'unknown'
      void showError(
        `Lysark: the course's engine and this extension don't match (messages version ${theirs} and ` +
          `${this.protocol}). Update the course's engine with the Update engine workflow, or update the extension.`,
      )
      return
    }
    const key = this.protocol >= 3 ? JSON.stringify(Array.isArray(message.include) ? message.include : []) : '[]'
    await this.queued(async () => {
      if (key !== this.includeKey) {
        // the page names the files it wants: files numbered before it did lack
        // them, so number the latest slides.md again, with them
        this.includeKey = key
        this.include = includePatterns(JSON.parse(key))
        const previous = this.latest
        if (previous !== null) {
          const files = await this.gather(this.textOf(previous))
          if (JSON.stringify(files) !== JSON.stringify(this.texts.get(previous))) {
            this.record(files)
            // the same slides.md as the text the page accepted, with the newly
            // included files added: start with it, instead of starting with the
            // old set and then loading afresh for the new one
            if (this.accepted === previous) this.accepted = this.latest
          }
        }
      }
      if (this.latest === null) this.record(await this.gather())
    })
    if (message.render !== this.renders || this.disposed) return
    // the page (re)loaded: it starts with the last text it accepted (or the
    // document, the first time). Then the latest text, if newer: one it
    // hasn't answered (it may have been lost in the reload), or a refused
    // one, so its error shows again.
    this.pageReady = true
    const first = this.accepted ?? this.latest!
    this.slide = this.send(first)
    this.booting = first
    if (this.latest! > first) this.send(this.latest!)
  }

  // ---- the host, messages version 3 (docs/editor-host.md) --------------------

  private async answer(message: HostRequest): Promise<void> {
    // the page that asked: an answer that comes after it was replaced isn't for the new one
    const page = this.renders
    let reply: Record<string, unknown>
    try {
      switch (message.type) {
        case 'lysark:read': {
          const as = message.as === 'bytes' ? 'bytes' : 'text'
          // one request at a time: each may hold many megabytes
          const files = this.read(message.paths, as, page, this.reads)
          this.reads = files.catch(() => undefined)
          reply = await files
          break
        }
        case 'lysark:list':
          reply = await this.list(message.dir)
          break
        case 'lysark:edit': {
          const done = this.edits.then(() => this.edit(message.label, message.changes))
          this.edits = done.catch(() => undefined)
          reply = await done
          break
        }
        case 'lysark:ask':
          reply = { value: await this.ask(message.title, message.items, message.input) }
          break
      }
    } catch {
      // never the error's own message: it can hold paths on this computer
      reply = { ok: false, message: 'the request failed' }
    }
    if (!this.disposed && page === this.renders) this.post({ type: 'lysark:reply', id: message.id, ...reply })
  }

  /**
   * A path the panel named, relative to the lecture folder: inside the lecture
   * folder, or for reading also the course's assets/ folder. `rel` is the
   * path relative to the lecture folder, cleaned up (null in assets/).
   * `slides.md` is the document being previewed. null for anything else.
   */
  private resolve(path: unknown, forWriting = false): { uri: vscode.Uri; rel: string | null } | null {
    if (typeof path !== 'string') return null
    const lecture = this.lectureDir.path
    const assets = this.assetsPath
    const roots = forWriting || !assets ? [lecture] : [lecture, assets]
    const resolved = resolveInside(lecture, path, roots)
    if (resolved === null) return null
    const rel = resolved === lecture ? '' : resolved.startsWith(`${lecture}/`) ? resolved.slice(lecture.length + 1) : null
    if (rel === 'slides.md') return { uri: this.document.uri, rel }
    return { uri: this.lectureDir.with({ path: resolved }), rel }
  }

  /** a document's version as the panel gets it: never the same for a document closed and opened again */
  private versionOf(document: vscode.TextDocument): number {
    let epoch = this.epochs.get(document)
    if (epoch === undefined) this.epochs.set(document, (epoch = this.nextEpoch++))
    return epoch * 2 ** 32 + document.version
  }

  /**
   * The files, keyed by the paths asked for. A file past the request's total
   * is answered `later` (never the first), and the panel asks for it again
   * in a request of its own. Stops early if the page that asked was replaced.
   */
  private async read(paths: unknown, as: 'text' | 'bytes', page: number, after: Promise<unknown>): Promise<Record<string, unknown>> {
    await after
    if (!Array.isArray(paths) || paths.length > MAX_READ_FILES) return { ok: false, message: `more than ${MAX_READ_FILES} files in one request` }
    const out: Record<string, HostFile> = {}
    const done = new Map<string, HostFile>()
    let total = 0
    for (const path of paths) {
      if (typeof path !== 'string' || path in out) continue
      if (this.disposed || page !== this.renders) break
      const target = this.resolve(path)
      if (as === 'bytes' && target) this.pageImages.add(target.uri.with({ query: '', fragment: '' }).toString())
      if (!target || !(await this.noLinks(target.uri))) {
        out[path] = { error: "outside the lecture folder and the course's assets/ folder" }
        continue
      }
      // the same file under another spelling: the same answer
      const key = target.uri.toString()
      const known = done.get(key)
      if (known) {
        out[path] = known
        continue
      }
      try {
        const stat = await vscode.workspace.fs.stat(target.uri)
        if (stat.type !== vscode.FileType.File) {
          out[path] = { error: 'not a file' }
        } else if (as === 'text') {
          // the document, unsaved typing included; its version guards an edit made from it
          const document = await vscode.workspace.openTextDocument(target.uri)
          const text = document.getText()
          if (text.length > MAX_READ_BYTES) out[path] = { error: `larger than ${MAX_READ_BYTES / 1e6} MB` }
          else if (total > 0 && total + text.length > MAX_READ_TOTAL) out[path] = { later: true }
          else {
            out[path] = { text, version: this.versionOf(document) }
            total += text.length
          }
        } else if (stat.size > MAX_READ_BYTES) {
          out[path] = { error: `larger than ${MAX_READ_BYTES / 1e6} MB` }
        } else if (total > 0 && total + stat.size > MAX_READ_TOTAL) {
          out[path] = { later: true }
        } else {
          out[path] = { base64: bytesToBase64(await vscode.workspace.fs.readFile(target.uri)) }
          total += stat.size
        }
      } catch (err) {
        out[path] = { error: fileProblem(err) }
      }
      if (!out[path].later) done.set(key, out[path])
    }
    return { files: out }
  }

  private async list(dir: unknown): Promise<Record<string, unknown>> {
    const target = this.resolve(dir)
    if (!target || !(await this.noLinks(target.uri))) {
      return { ok: false, message: "outside the lecture folder and the course's assets/ folder" }
    }
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(target.uri)
    } catch (err) {
      return { ok: false, message: fileProblem(err) }
    }
    return {
      // links and hidden names are left out, like everything that isn't a plain file or folder
      entries: entries
        .filter(([name, type]) => !name.startsWith('.') && (type === vscode.FileType.File || type === vscode.FileType.Directory))
        .map(([name, type]) => ({ name, dir: type === vscode.FileType.Directory })),
    }
  }

  /**
   * Apply the panel's changes as one edit: each must change slides.md or a
   * scene file, computed on the document's current version, or create a new
   * scene file. All are checked before any is applied.
   */
  private async edit(label: unknown, changes: unknown): Promise<{ ok: boolean; message?: string }> {
    const refuse = (message: string) => ({ ok: false, message })
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) return refuse('no changes, or too many')
    // first everything that waits (opening documents, looking for files)…
    const creates: Array<{ uri: vscode.Uri; rel: string; contents: string }> = []
    const replaces: Array<{ document: vscode.TextDocument; rel: string; change: Record<string, unknown> }> = []
    for (const change of changes as Array<Record<string, unknown>>) {
      const target = this.resolve(change?.path, true)
      const rel = target?.rel ?? ''
      if (!target || !(await this.noLinks(target.uri))) return refuse(`the preview can't change ${String(change?.path)}`)
      if (change && typeof change.create === 'string') {
        if (!isCreatablePath(rel) || change.create.length > MAX_INCLUDED_BYTES) return refuse(`the preview can't create ${rel}`)
        if (creates.some((c) => c.rel === rel)) return refuse(`${rel} is created twice`)
        // its folder must be a folder (or not exist yet), and the file must not exist
        const problem = (await this.statProblem(vscode.Uri.joinPath(target.uri, '..'), vscode.FileType.Directory)) ??
          ((await this.statProblem(target.uri, null)) === null ? null : `${rel} already exists, or can't be checked`)
        if (problem) return refuse(problem === 'not a folder' ? `${rel}: its folder is a file` : problem)
        creates.push({ uri: target.uri, rel, contents: change.create })
      } else {
        if (!isWritablePath(rel)) return refuse(`the preview can't change ${rel || String(change?.path)}`)
        if (typeof change?.text !== 'string' || change.text.length > MAX_INCLUDED_BYTES) return refuse(`not a valid change to ${rel}`)
        let document: vscode.TextDocument
        try {
          document = await vscode.workspace.openTextDocument(target.uri)
        } catch {
          return refuse(`${rel} could not be opened`)
        }
        replaces.push({ document, rel, change })
      }
    }
    // …then, with nothing in between, the version checks and the edit, so
    // typing can't slip in between a check and the edit it guards. The text
    // changes go first: VS Code checks their versions again as it applies
    // them, and a refusal there then leaves no new file behind.
    const edit = new vscode.WorkspaceEdit()
    const before = new Map<vscode.TextDocument, { text: string; version: number }>()
    for (const { document, rel, change } of replaces) {
      if (this.versionOf(document) !== change.version) return refuse(`${rel} changed meanwhile; try again`)
      const text = document.getText()
      const { start, end } = change
      if (!isInt(start) || !isInt(end) || start < 0 || start > end || end > text.length) return refuse(`not a valid change to ${rel}`)
      if (!before.has(document)) before.set(document, { text, version: this.versionOf(document) })
      edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), change.text as string)
    }
    for (const { uri, contents } of creates) edit.createFile(uri, { contents: new TextEncoder().encode(contents) })
    const applied = await vscode.workspace.applyEdit(edit)
    // VS Code applies the text changes, then creates the files, and doesn't take
    // the text changes back if a file can't be created: what it did is kept as
    // an edit of the panel's (Ctrl+Z undoes it) and sent to the panel
    const changed = [...before].filter(([document, b]) => this.versionOf(document) !== b.version)
    for (const [document, b] of changed) this.rememberPanelEdit(document, b.text)
    if (!applied) {
      if (changed.length === 0) return refuse('VS Code refused the edit; try again')
      this.sendDocument(changed.some(([document]) => document === this.document) ? 'live' : 'last')
      return refuse('VS Code made the text changes but could not create the new file (Ctrl+Z undoes the changes)')
    }
    const touched = [...replaces.map((r) => r.rel), ...creates.map((c) => c.rel)]
    const what = notificationText(typeof label === 'string' ? label.slice(0, 80) : 'Edit')
    vscode.window.setStatusBarMessage(`$(check) Lysark: ${what} (${notificationText(touched.join(', '))})`, 4000)
    // the panel gets the edited files, as after a save; slides.md with its
    // typing only if the edit changed slides.md (the edit sits on top of it)
    this.sendDocument(before.has(this.document) ? 'live' : 'last')
    return { ok: true }
  }

  /**
   * null if `uri` is fine: of type `type`, or for `null` not there at all;
   * otherwise what's wrong. Missing is fine for a folder (it is made as needed).
   */
  private async statProblem(uri: vscode.Uri, type: vscode.FileType | null): Promise<string | null> {
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      return type !== null && stat.type === type ? null : type === vscode.FileType.Directory ? 'not a folder' : 'already exists'
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code
      return code === 'FileNotFound' || code === 'EntryNotFound' ? null : fileProblem(err)
    }
  }

  /** an edit the panel made to `document`, which held `before` until then */
  private rememberPanelEdit(document: vscode.TextDocument, before: string): void {
    const after = document.getText()
    this.panelEdits.push({ uri: document.uri.toString(), before, after })
    if (this.panelEdits.length > PANEL_EDITS_KEPT) this.panelEdits.shift()
    this.lastText.set(document.uri.toString(), after)
  }

  /**
   * A choice from `items`, or text typed into `input`; null if cancelled or
   * not allowed. Only one at a time, and only within a few seconds of a click
   * on one of the preview's buttons (Scene Actions…, the camera) or of
   * answering the last question: a page can't put up a question by itself
   * while you type elsewhere. (Keys pressed inside the panel are the page's to
   * handle with its own dialogs.) Always titled as the Lysark preview's, so it
   * can't pass for VS Code's own. The texts go through notificationText: VS
   * Code shows an input box's prompt with `[label](command:…)` as a link that
   * runs the command. The panel checks a typed answer itself, and asks again if
   * it won't do (a pattern from the panel would run here, where a slow one
   * could hang VS Code).
   */
  private async ask(title: unknown, items: unknown, input: unknown): Promise<string | null> {
    if (this.asking || Date.now() > this.askUntil) {
      vscode.window.setStatusBarMessage('$(info) Lysark: the preview asked a question by itself; it was not shown', 4000)
      return null
    }
    this.asking = true
    try {
      const answer = await this.showQuestion(title, items, input)
      // a question answered may lead to the next one (a name after a choice)
      this.askUntil = answer === null ? 0 : Date.now() + ASK_WINDOW_MS
      return answer
    } finally {
      this.asking = false
    }
  }

  private async showQuestion(title: unknown, items: unknown, input: unknown): Promise<string | null> {
    const text = (s: unknown, max = 300) => (typeof s === 'string' ? notificationText(s.slice(0, max)) : undefined)
    const heading = `Lysark preview: ${(text(title, 120) ?? '').replace(/^Lysark( preview)?:\s*/i, '')}`
    if (Array.isArray(items)) {
      const choices = items
        .filter((i): i is { label: string; description?: unknown; value: string } => typeof i?.label === 'string' && typeof i?.value === 'string')
        .slice(0, 100)
        .map((i) => ({ label: text(i.label, 120)!, description: text(i.description, 120), value: i.value }))
      return (await vscode.window.showQuickPick(choices, { title: heading }))?.value ?? null
    }
    if (input && typeof input === 'object') {
      const field = input as { prompt?: unknown; value?: unknown; placeholder?: unknown }
      const answer = await vscode.window.showInputBox({
        title: heading,
        prompt: text(field.prompt),
        value: typeof field.value === 'string' ? field.value.slice(0, 300) : undefined,
        placeHolder: text(field.placeholder),
      })
      return answer ?? null
    }
    return null
  }

  // ---- version 2: the extension writes saved views ---------------------------

  /**
   * write the camera view into the slide's frontmatter as one small text edit.
   * `slide` counts the slides of `shownText`, the text the preview shows.
   */
  private async saveView(slide: number, shownText: string | undefined, view: CameraView): Promise<void> {
    const oldText = this.document.getText()
    const index = shownText === undefined ? -1 : matchSlide(shownText, oldText, slide)
    if (index < 0) {
      void showError(
        'Lysark: the view was not saved, because that slide has changed since the preview last updated. Save the file, then save the view again.',
      )
      return
    }
    let newText: string
    try {
      newText = setCameraView(oldText, index, view)
    } catch (err) {
      void showError(`Lysark: the view was not saved: ${(err as Error).message}`)
      return
    }
    const change = singleEdit(oldText, newText)
    if (!change) return
    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      this.document.uri,
      new vscode.Range(this.document.positionAt(change.start), this.document.positionAt(change.end)),
      change.text,
    )
    if (!(await vscode.workspace.applyEdit(edit))) {
      void showError('Lysark: the view was not saved: VS Code refused the edit.')
      return
    }
    this.rememberPanelEdit(this.document, oldText)
    // the panel takes the new view at once (only the camera changed, so without
    // loading afresh); otherwise leaving the slide and coming back would fly to
    // the old one until the next save
    this.sendDocument('live')
  }
}
