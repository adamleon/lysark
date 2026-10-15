import * as vscode from 'vscode'
import { slideAtLine, slideRanges } from '../../src/compiler/slide-ranges'
import { setCameraView, type CameraView } from '../../src/editor/camera-edit'
import { EDITOR_PROTOCOL, editorAssets, editorProtocol, messagePage, panelPage } from '../../src/editor/panel-page.js'
import { editorUrl, isCameraView, isCoursePackage, matchSlide, notificationText, singleEdit } from './logic'

/**
 * The Lysark VS Code extension (lysark-v2.md §5, step 3). It is a thin host:
 * the panel's page loads the editor runtime's files from the course's own
 * GitHub Pages site (built from the engine version the course uses), the
 * extension sends it the lecture text, and turns what the runtime reports back
 * into text edits. It runs in desktop VS Code, vscode.dev and github.dev alike,
 * so it uses only the vscode API and fetch.
 */

/** a panel that hasn't said 'ready' by then gets a warning */
const READY_TIMEOUT_MS = 30_000
/** reading the site's editor page gives up after this */
const FETCH_TIMEOUT_MS = 15_000

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
    vscode.commands.registerCommand('lysark.openPreview', async (uri?: vscode.Uri) => {
      const document = uri
        ? await vscode.workspace.openTextDocument(uri)
        : vscode.window.activeTextEditor?.document
      if (!document) {
        void showError('Lysark: open a lecture’s slides.md first.')
        return
      }
      if (preview?.document === document) {
        // ▷ again: show the current text (and retry a preview that didn't load)
        preview.panel.reveal(vscode.ViewColumn.Beside, true)
        preview.refresh()
        return
      }
      let site: { url: string; fromWorkspace: boolean }
      try {
        site = await runtimeUrl(document.uri)
      } catch (err) {
        void showError(`Lysark: ${(err as Error).message}`)
        return
      }
      if (site.fromWorkspace && !(await confirmSite(context, site.url))) return
      preview?.panel.dispose()
      const opened: Preview = new Preview(document, site.url, () => {
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
 * settings), not the user.
 */
async function runtimeUrl(slidesUri: vscode.Uri): Promise<{ url: string; fromWorkspace: boolean }> {
  const config = vscode.workspace.getConfiguration('lysark')
  const setting = config.get<string>('editorUrl') ?? ''
  if (setting.trim()) {
    const where = config.inspect<string>('editorUrl')
    return { url: editorUrl(setting, null), fromWorkspace: !!(where?.workspaceValue || where?.workspaceFolderValue) }
  }
  const packageJson = await findCoursePackage(slidesUri)
  if (!packageJson) {
    throw new Error('this file is not inside a Lysark course (no package.json that depends on lysark was found above it).')
  }
  return { url: editorUrl('', packageJson), fromWorkspace: true }
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

/** the nearest package.json above the file that belongs to a Lysark course */
async function findCoursePackage(file: vscode.Uri): Promise<unknown> {
  const root = vscode.workspace.getWorkspaceFolder(file)?.uri
  let dir = vscode.Uri.joinPath(file, '..')
  for (let depth = 0; depth < 20; depth++) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, 'package.json'))
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (isCoursePackage(json)) return json
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

type FromRuntime =
  | { type: 'lysark:ready'; protocol?: unknown; render?: number }
  | { type: 'lysark:shown'; seq: number; index?: number }
  | { type: 'lysark:accepted'; seq: number }
  | { type: 'lysark:slide'; index: number; seq: number | null }
  | { type: 'lysark:save-view'; slide: number; seq: number | null; view: unknown }
  | { type: 'lysark:error'; message: string; seq?: number; fatal?: boolean }

/**
 * One preview panel. Every text it sends is numbered (seq) and kept until the
 * runtime has moved past it: slide numbers from the runtime count the slides of
 * the text it shows, which can differ from the document, through unsaved edits
 * or a save the runtime refused because the text had an error. matchSlide
 * translates between the two.
 */
class Preview {
  readonly panel: vscode.WebviewPanel
  /** the slide the runtime shows, counted in the text it shows */
  private slide = 0
  private seq = 0
  private readonly texts = new Map<number, string>()
  /** the last text sent, the last one the runtime accepted, and the one it shows */
  private latest: number | null = null
  private accepted: number | null = null
  private shown: number | null = null
  /** the text a fresh page is starting with, from its 'ready' until its 'shown' */
  private booting: number | null = null
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
  /** why the document is being saved, from onWillSave to onDidSave */
  private saveReason: vscode.TextDocumentSaveReason | undefined
  private disposed = false

  constructor(
    readonly document: vscode.TextDocument,
    /** the editor's folder on the course site; follows a redirect (say, to a custom domain) */
    private base: string,
    onClose: () => void,
  ) {
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
      // new text reaches the preview when you save (Ctrl+S), so typing doesn't
      // reload it. Auto-save, on by default in the browser versions, would
      // reload the panel at every pause, so it doesn't count.
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.document === this.document) this.saveReason = e.reason
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d !== this.document) return
        const reason = this.saveReason
        this.saveReason = undefined
        if (reason === vscode.TextDocumentSaveReason.Manual) this.refresh()
      }),
      // moving the cursor to another slide shows that slide (not when an edit,
      // such as a saved view, moves it)
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const byHand =
          e.kind === vscode.TextEditorSelectionChangeKind.Keyboard || e.kind === vscode.TextEditorSelectionChangeKind.Mouse
        if (byHand && e.textEditor.document === this.document) this.followCursor(e.selections[0].active.line)
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

  /** show the document's current text, and retry a preview that didn't load */
  refresh(): void {
    if (this.document.getText() !== this.textOf(this.latest)) this.sendDocument()
    if (this.stalled) this.retry()
  }

  /** a notification's Retry: only if the preview still needs it, not after it recovered */
  private async offerRetry(shown: Thenable<string | undefined>): Promise<void> {
    if ((await shown) === 'Retry' && !this.disposed && this.stalled) this.retry()
  }

  requestView(): void {
    if (this.pageReady) this.post({ type: 'lysark:request-view' })
    else vscode.window.setStatusBarMessage('$(sync~spin) Lysark: the preview is still loading', 3000)
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
      const protocol = editorProtocol(html)
      if (protocol !== EDITOR_PROTOCOL) {
        throw new Error(
          protocol === null || protocol < EDITOR_PROTOCOL
            ? "the course's engine is older than this extension. Run Update engine in the course repo (engine v2.3.0 or later)"
            : "this extension is older than the course's engine. Update the Lysark extension",
        )
      }
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
    this.renders += 1
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
    return typeof seq === 'number' ? this.texts.get(seq) : undefined
  }

  /** send text `seq`, asking for the slide shown now, found in that text; returns that slide */
  private send(seq: number): number {
    const text = this.texts.get(seq)!
    const showing = this.textOf(this.shown)
    const found = showing === undefined ? this.slide : matchSlide(showing, text, this.slide)
    const slide = found >= 0 ? found : this.slide
    this.post({ type: 'lysark:source', text, seq, slide, protocol: EDITOR_PROTOCOL })
    return slide
  }

  /** number the document's current text as the latest */
  private recordDocument(): void {
    this.seq += 1
    this.texts.set(this.seq, this.document.getText())
    this.latest = this.seq
  }

  private sendDocument(): void {
    this.recordDocument()
    // while a page loads, its 'ready' sends the latest text
    if (this.pageReady) this.send(this.seq)
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
      case 'lysark:ready': {
        // a late 'ready' from the page the current one replaced
        if (message.render !== this.renders) break
        clearTimeout(this.readyTimer)
        this.readyTimedOut = false
        if (message.protocol !== EDITOR_PROTOCOL) {
          const theirs = Number.isInteger(message.protocol) ? message.protocol : 'unknown'
          void showError(
            `Lysark: the course's engine and this extension don't match (messages version ${theirs} and ` +
              `${EDITOR_PROTOCOL}). Update the course's engine with the Update engine workflow, or update the extension.`,
          )
          break
        }
        // the page (re)loaded: it starts with the last text it accepted (or the
        // document, the first time). Then the latest text, if newer: one it
        // hasn't answered (it may have been lost in the reload), or a refused
        // one, so its error shows again.
        this.pageReady = true
        if (this.latest === null) this.recordDocument()
        const first = this.accepted ?? this.latest!
        this.slide = this.send(first)
        this.booting = first
        if (this.latest! > first) this.send(this.latest!)
        break
      }
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
        if (Number.isInteger(message.slide) && message.slide >= 0 && isCameraView(message.view)) {
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
    }
  }

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
    }
  }
}
