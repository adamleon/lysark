# Lysark

Preview [Lysark](https://github.com/adamleon/lysark) lecture slides beside their text, and save
3D camera views into them. Works in desktop VS Code, vscode.dev, and github.dev, so a lecture can
be fixed from any browser.

## Use

1. Open a lecture's `slides.md` in a Lysark course repository.
2. Click the ▷ button in the editor's title bar, or run **Open Lysark Preview** from the Command
   Palette (F1).
3. The preview follows the cursor to the slide you are editing, and shows your changes each time
   you save.
4. On a slide with a 3D scene, move the camera with the mouse, click in it, and press **V** (or
   click the camera button in the panel's title bar). The view is written into that slide's
   `camera:` frontmatter as a normal text change, ready to commit.
5. **Scene Actions…** (the list button on the panel's title bar) shows what the preview can do
   with the scene. Needs the course on engine v2.4.0 or later.

## Finding your way in slides.md

From version 0.4.0, in a lecture's `lectures/<name>/slides.md` in a Lysark course:

- **Each slide's settings are folded** the first time the file opens: the block from the
  slide's first `---` to the next reads `--- ⋯`. Click the ⋯ to open one. **Lysark: Fold or
  Unfold Slide Settings** (F1) folds them all if one on screen is open, and otherwise opens them
  all.
- **A line across the text marks where each slide starts**, with the slide's number and `id:`
  after its `---` (`slide 4 · ptp`), and a mark in the scroll bar.
- **The Outline, the breadcrumbs above the text, Quick Outline (Ctrl+Shift+O) and sticky scroll
  show only the slides' headings**, not lines from the settings.

A folded block stays folded when the preview writes a view into it (V). After the first time,
VS Code keeps the folds as you left them, also when the file is opened again, so the settings of
a slide you add stay open until you fold them. Other files, such as `README.md` or another slide
tool's `slides.md`, are not changed. In a Remote window of desktop VS Code (not tried), VS Code's
Markdown extension runs on the other machine and can't get Lysark's plugin, so the outline and
some of the folding don't work there.

## How it finds the preview

The preview itself is part of the course's published site, built from the engine version the
course uses, at `<homepage>/_lysark/editor/` (engine v2.3.0 or later). New editor features
arrive with the engine, so the extension rarely needs updating. When the preview asks, it reads
files from the lecture folder and the course's `assets/` folder, and edits only the lecture's
`slides.md` and its scene files (`scenes/*.yaml` or `.yml`), as changes you can undo. The extension takes
`homepage` from the course's `package.json`:

```json
"homepage": "https://adamleon.github.io/ais2105-lectures/"
```

The `lysark.editorUrl` setting overrides this, for testing a local build of the editor.
