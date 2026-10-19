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
