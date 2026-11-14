import * as vscode from 'vscode'
import { blankSettings, foldingBlocks, isLecturePath, separators, SlideTracker, toggleAction, type Settings } from './slide-blocks'

/**
 * Finding one's way in a lecture's slides.md (docs/slide-navigation.md). Three
 * parts:
 *
 * - A markdown-it plugin for VS Code's Markdown extension, which builds the
 *   Outline, breadcrumbs, Quick Outline (Ctrl+Shift+O), sticky scroll and its
 *   own folding from what markdown-it parses. The plugin hides each slide's
 *   settings block from that parse, so YAML comments and settings lines no
 *   longer show up as headings.
 * - Folding: each settings block is a folding range of the kind Imports, which
 *   VS Code folds when the file opens, since the extension sets
 *   editor.foldingImportsByDefault for Markdown (package.json).
 * - A separator on each slide's opening `---` line: a line across the text, a
 *   mark in the scroll bar, and the slide's number and id.
 *
 * A lecture's slides.md is a file `lectures/<name>/slides.md` in a Lysark
 * course (as for the preview: a package.json above it that depends on
 * lysark) or in the engine's own repository; any other file, Markdown or
 * not, is left alone. All three parts take the settings blocks from one
 * SlideTracker per document, so they agree while a new slide is half typed
 * (slide-blocks.ts). This runs in every workspace that has Markdown (the
 * extension activates on it), so it does nothing until a lecture is involved.
 */

/** the part of markdown-it the plugin uses */
interface MarkdownIt {
  parse(src: string, env: unknown): unknown
}

/** what activate() returns: the Markdown extension asks for it to get the plugin */
export interface NavigationExports {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt
}

/** whether a file is inside a Lysark course or the engine's repository (extension.ts) */
export type InLysark = (file: vscode.Uri) => Promise<boolean>

const LECTURES: vscode.DocumentSelector = { scheme: '*', language: 'markdown', pattern: '**/lectures/*/slides.md' }
/** separators are redrawn this long after the last change */
const REDRAW_MS = 200

const trackers = new WeakMap<vscode.TextDocument, SlideTracker>()
/** whether VS Code's Markdown extension in this extension host has taken the plugin */
let pluginTaken = false
/** what the fold command did last, per document */
const toggled = new WeakMap<vscode.TextDocument, 'fold' | 'unfold'>()

/** a lecture's settings blocks, for its text now (or `text`, which is its text now) */
function settingsOf(document: vscode.TextDocument, text = document.getText()): Settings {
  let tracker = trackers.get(document)
  if (!tracker) trackers.set(document, (tracker = new SlideTracker()))
  return tracker.settings(text)
}

export function registerNavigation(context: vscode.ExtensionContext, inLysark: InLysark): NavigationExports {
  // whether each document is a lecture, by its uri; `known` once answered, for the plugin, which can't wait
  const asked = new Map<string, Promise<boolean>>()
  const known = new Map<string, boolean>()
  const isLecture = (document: vscode.TextDocument): Promise<boolean> => {
    const key = document.uri.toString()
    let answer = asked.get(key)
    if (!answer) {
      answer = isLecturePath(document.uri.path) ? inLysark(document.uri).catch(() => false) : Promise.resolve(false)
      void answer.then((yes) => known.set(key, yes))
      asked.set(key, answer)
    }
    return answer
  }
  // a lecture's blocks as it opens: the tracker's first text (SlideTracker.foldsOnOpen)
  const opened = (document: vscode.TextDocument) => {
    if (!isLecturePath(document.uri.path)) return
    void isLecture(document)
    settingsOf(document)
  }

  /**
   * The plugin. The Markdown extension calls this once, with the markdown-it it
   * parses every Markdown text with, and gives no document with the text, so
   * the plugin knows a lecture by its text: exactly the text of an open
   * lecture. Anything else is parsed as it is. Until the course is known
   * (VS Code may parse a file before the package.json above it has been
   * read), a file at a lecture's path counts as a lecture.
   */
  const extendMarkdownIt = (md: MarkdownIt): MarkdownIt => {
    const parse = md.parse.bind(md)
    md.parse = (src: string, env: unknown) => parse(withoutSettings(src), env)
    pluginTaken = true
    return md
  }
  const withoutSettings = (src: string): string => {
    try {
      if (typeof src !== 'string') return src
      for (const document of vscode.workspace.textDocuments) {
        if (!isLecturePath(document.uri.path) || document.getText() !== src) continue
        void isLecture(document)
        if (known.get(document.uri.toString()) === false) return src
        const { blocks, strays } = settingsOf(document, src)
        return blankSettings(src, blocks, strays)
      }
    } catch {
      // never stop Markdown from parsing
    }
    return src
  }

  /**
   * Lysark: Fold or Unfold Slide Settings: fold every block if one in sight
   * has its settings open, otherwise open every block (toggleAction). VS Code's
   * own Toggle Import Fold flips each block, so after one was opened by
   * clicking its ⋯ it would open all the others and fold that one.
   */
  const toggleSettings = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const document = editor.document
    if (!(await isLecture(document))) {
      void vscode.window.showInformationMessage('Lysark: this is not a lecture’s slides.md (lectures/<name>/slides.md in a Lysark course).')
      return
    }
    const blocks = foldingBlocks(settingsOf(document).blocks)
    if (blocks.length === 0) return
    // without the plugin (in a Remote window the Markdown extension runs on the other machine),
    // Markdown's own folding ranges cross the blocks and VS Code drops some of them, so folding
    // at their lines would fold slide text
    if (!pluginTaken) {
      void vscode.window.showWarningMessage(
        'Lysark: the slide settings can’t be folded here: VS Code’s Markdown extension hasn’t taken Lysark’s plugin in this window (as in a Remote window).',
      )
      return
    }
    const visible = editor.visibleRanges.map((r) => ({ start: r.start.line, end: r.end.line }))
    // before the command's first run, the blocks are as the file opened: folded, unless it had none to fold
    const action = toggleAction(blocks, visible, toggled.get(document) ?? (trackers.get(document)?.foldsOnOpen === false ? 'unfold' : 'fold'))
    toggled.set(document, action)
    await vscode.commands.executeCommand(action === 'fold' ? 'editor.fold' : 'editor.unfold', {
      selectionLines: blocks.map((b) => b.start),
      levels: 1,
      direction: 'down',
    })
  }

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(LECTURES, {
      provideFoldingRanges: async (document) => {
        if (!(await isLecture(document))) return []
        const blocks = foldingBlocks(settingsOf(document).blocks)
        // Imports only in a document that had a block to fold when it opened (SlideTracker.foldsOnOpen)
        const kind = trackers.get(document)?.foldsOnOpen ? vscode.FoldingRangeKind.Imports : undefined
        return blocks.map((b) => new vscode.FoldingRange(b.start, b.end, kind))
      },
    }),
    vscode.commands.registerCommand('lysark.toggleSlideSettings', toggleSettings),
    vscode.workspace.onDidOpenTextDocument(opened),
  )
  vscode.workspace.textDocuments.forEach(opened)
  registerSeparators(context, isLecture)
  return { extendMarkdownIt }
}

/** the separator on each slide's opening line, in every editor that shows a lecture */
function registerSeparators(context: vscode.ExtensionContext, isLecture: (document: vscode.TextDocument) => Promise<boolean>): void {
  const line = new vscode.ThemeColor('textLink.foreground')
  const label = new vscode.ThemeColor('descriptionForeground')
  const separator = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderStyle: 'solid',
    borderWidth: '2px 0 0 0',
    borderColor: line,
    overviewRulerColor: line,
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  })
  const draw = async (editor: vscode.TextEditor) => {
    const document = editor.document
    if (!isLecturePath(document.uri.path) || !(await isLecture(document))) return
    try {
      editor.setDecorations(
        separator,
        separators(settingsOf(document).blocks).map((s) => ({
          range: document.lineAt(s.line).range,
          // shown after the `---`, and before the ⋯ of a folded block
          renderOptions: { after: { contentText: s.label, color: label, margin: '0 1ch 0 2ch' } },
        })),
      )
    } catch {
      // the editor closed meanwhile
    }
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const redraw = (document: vscode.TextDocument) => {
    const key = document.uri.toString()
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) void draw(editor)
      }, REDRAW_MS),
    )
  }
  context.subscriptions.push(
    separator,
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => void draw(editor))),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isLecturePath(e.document.uri.path) || e.contentChanges.length === 0) return
      // every change, so the tracker has the last text that split into slides when typing starts a new one
      settingsOf(e.document)
      redraw(e.document)
    }),
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  )
  vscode.window.visibleTextEditors.forEach((editor) => void draw(editor))
}
