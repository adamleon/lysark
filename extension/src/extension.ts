import * as vscode from 'vscode'
import { slideAtLine, slideRanges } from '../../src/compiler/slide-ranges'
import { setCameraView, type CameraView } from '../../src/editor/camera-edit'
import { editorUrl, isCameraView, isCoursePackage, matchSlide, singleEdit } from './logic'

/**
 * The Lysark VS Code extension (lysark-v2.md §5, step 3). It is a thin host:
 * the panel shows the editor runtime from the course's own GitHub Pages site
 * (built from the engine version the course uses), sends it the lecture text,
 * and turns what the runtime reports back into text edits. It runs in desktop
 * VS Code, vscode.dev and github.dev alike, so it uses only the vscode API.
 */

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
        void vscode.window.showErrorMessage('Lysark: open a lecture’s slides.md first.')
        return
      }
      if (preview?.document === document) {
        preview.panel.reveal(vscode.ViewColumn.Beside, true)
        return
      }
      let url: string
      try {
        url = await runtimeUrl(document.uri)
      } catch (err) {
        void vscode.window.showErrorMessage(`Lysark: ${(err as Error).message}`)
        return
      }
      preview?.panel.dispose()
      const opened: Preview = new Preview(document, url, () => {
        if (preview === opened) preview = null
      })
      preview = opened
    }),
    { dispose: () => preview?.panel.dispose() },
  )
}

export function deactivate(): void {}

/** the editor runtime's address, from the setting or the course's package.json */
async function runtimeUrl(slidesUri: vscode.Uri): Promise<string> {
  const setting = vscode.workspace.getConfiguration('lysark').get<string>('editorUrl') ?? ''
  if (setting.trim()) return editorUrl(setting, null)
  const packageJson = await findCoursePackage(slidesUri)
  if (!packageJson) {
    throw new Error('this file is not inside a Lysark course (no package.json that depends on lysark was found above it).')
  }
  return editorUrl('', packageJson)
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
  | { type: 'lysark:ready' }
  | { type: 'lysark:shown'; seq: number }
  | { type: 'lysark:accepted'; seq: number }
  | { type: 'lysark:slide'; index: number; seq: number | null }
  | { type: 'lysark:save-view'; slide: number; seq: number | null; view: unknown }
  | { type: 'lysark:error'; message: string; seq?: number }

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
  /** the last text sent, the last one the runtime accepted, the last it refused, and the one it shows */
  private latest: number | null = null
  private accepted: number | null = null
  private refused: number | null = null
  private shown: number | null = null
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    readonly document: vscode.TextDocument,
    url: string,
    onClose: () => void,
  ) {
    const folder = document.uri.path.split('/').slice(-2, -1)[0] ?? 'slides'
    this.panel = vscode.window.createWebviewPanel(
      'lysark.preview',
      `Lysark: ${folder}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      // keep the 3D scene alive while the tab is in the background; the panel
      // loads nothing from the workspace
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    )
    this.panel.webview.html = panelHtml(url)

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: FromRuntime) => this.onMessage(m)),
      // new text reaches the preview on save, so typing doesn't reload it
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d === this.document && d.getText() !== this.textOf(this.latest)) this.sendDocument()
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
      for (const d of this.disposables) d.dispose()
      onClose()
    })
  }

  requestView(): void {
    this.post({ type: 'lysark:request-view' })
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }

  private textOf(seq: number | null | undefined): string | undefined {
    return typeof seq === 'number' ? this.texts.get(seq) : undefined
  }

  /** send text `seq`, asking for the slide shown now, found in that text */
  private send(seq: number): void {
    const text = this.texts.get(seq)!
    const showing = this.textOf(this.shown)
    const slide = showing === undefined ? this.slide : matchSlide(showing, text, this.slide)
    this.post({ type: 'lysark:source', text, seq, slide: slide >= 0 ? slide : this.slide })
  }

  private sendDocument(): void {
    this.seq += 1
    this.texts.set(this.seq, this.document.getText())
    this.latest = this.seq
    this.send(this.seq)
  }

  /** forget texts the runtime has moved past */
  private prune(): void {
    const needed = [this.shown, this.accepted, this.latest].filter((s): s is number => s !== null)
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
    const showing = this.textOf(this.shown)
    const target = index < 0 || showing === undefined ? index : matchSlide(text, showing, index)
    // -1: a slide the preview doesn't have yet (new or edited, not saved)
    if (target >= 0 && target !== this.slide) {
      this.slide = target
      this.post({ type: 'lysark:goto', slide: target })
    }
  }

  private onMessage(message: FromRuntime): void {
    switch (message?.type) {
      case 'lysark:ready': {
        // the page (re)loaded: give it the last text it accepted, then any
        // newer one it hasn't answered, which may have been lost in the reload
        if (this.accepted !== null) this.send(this.accepted)
        const latest = this.latest
        if (latest === null) this.sendDocument()
        else if (latest !== this.refused && (this.accepted === null || latest > this.accepted)) this.send(latest)
        break
      }
      case 'lysark:shown':
        if (this.texts.has(message.seq)) {
          this.shown = message.seq
          this.accepted = Math.max(this.accepted ?? message.seq, message.seq)
          this.prune()
        }
        break
      case 'lysark:accepted':
        if (this.texts.has(message.seq)) {
          this.accepted = Math.max(this.accepted ?? message.seq, message.seq)
          this.prune()
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
      case 'lysark:error':
        if (typeof message.seq === 'number') this.refused = message.seq
        vscode.window.setStatusBarMessage(`$(warning) Lysark: ${String(message.message).split('\n')[0]}`, 8000)
        break
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
      void vscode.window.showErrorMessage(
        'Lysark: the view was not saved, because that slide has changed since the preview last updated. Save the file, then save the view again.',
      )
      return
    }
    let newText: string
    try {
      newText = setCameraView(oldText, index, view)
    } catch (err) {
      void vscode.window.showErrorMessage(`Lysark: the view was not saved: ${(err as Error).message}`)
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
      void vscode.window.showErrorMessage('Lysark: the view was not saved: VS Code refused the edit.')
    }
  }
}

function panelHtml(url: string): string {
  const origin = new URL(url).origin
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  // The panel only relays: runtime → extension, and extension → runtime (to the
  // runtime's origin only). The extension's messages come from VS Code's own
  // frames, which share this page's origin (not always from window.parent:
  // checked in VS Code for the web, October 2026); anything else, such as a
  // frame inside the slides, is ignored.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${attr(origin)}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #111; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe id="lysark" src="${attr(url)}" allow="fullscreen"></iframe>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  const frame = document.getElementById('lysark')
  const origin = ${JSON.stringify(origin).replace(/</g, '\\u003c')}
  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || typeof data.type !== 'string' || !data.type.startsWith('lysark:')) return
    if (event.source === frame.contentWindow) {
      if (event.origin === origin) vscode.postMessage(data)
    } else if (event.origin === window.origin) {
      frame.contentWindow.postMessage(data, origin)
    }
  })
</script>
</body>
</html>`
}
