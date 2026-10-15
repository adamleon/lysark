# Lysark

Preview [Lysark](https://github.com/adamleon/lysark) lecture slides beside their text, and save
3D camera views into them. Works in desktop VS Code, vscode.dev, and github.dev, so a lecture can
be fixed from any browser.

## Use

1. Open a lecture's `slides.md` in a Lysark course repository.
2. Click the preview button in the editor's title bar, or run **Lysark: Open Preview**.
3. The preview follows the cursor to the slide you are editing, and shows your changes each time
   you save.
4. On a slide with a 3D scene, move the camera with the mouse and press **V**. The view is written
   into that slide's `camera:` frontmatter as a normal text change, ready to commit.

## How it finds the preview

The preview itself is part of the course's published site, built from the engine version the
course uses, at `<homepage>/_lysark/editor/`. The extension takes `homepage` from the course's
`package.json`:

```json
"homepage": "https://adamleon.github.io/ais2105-lectures/"
```

The `lysark.editorUrl` setting overrides this, for testing a local build of the editor.
