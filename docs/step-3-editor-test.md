# Step 3, the test: the Lysark extension

How the first version of the Lysark VS Code extension works. It is the test that starts step 3 of
[lysark-v2.md](lysark-v2.md): a panel beside `slides.md` that shows the live lecture and saves a 3D
camera view into the slide. Written for the author; no engine knowledge needed.

## Using it

1. Open a lecture's `slides.md`: in github.dev (press `.` on the course's GitHub page), or in
   desktop VS Code with a clone.
2. Click the ▷ button in the editor's title bar (**Open Lysark Preview**). The panel opens beside
   the text.
3. **The panel follows the cursor:** click in another slide's text and the panel shows that slide.
4. **The panel updates when you save** (Ctrl+S). The whole panel reloads, so the camera goes back
   to the slide's own view. Text with an error leaves the last good version showing, with the
   error in a red box.
5. **Save a camera view:** move the camera with the mouse, then press **V** in the panel or click
   the camera button in the panel's title bar. The view goes into that slide's `camera:` as
   `lookAt` and `offset`, rounded to two decimals, as an unsaved change. Nothing else in the file
   changes, so Source Control shows exactly those lines. Ctrl+Z in the text undoes it.
   - A slide that looks at an anchor (`lookAt: tool`) keeps it; only `offset` changes.
   - A `distance:` is replaced by the `offset:`.
   - A slide with no `camera:` gets one.
6. Commit with the Source Control button, as for any other edit.

## How it works

There are three pieces.

**The editor runtime** is the normal deck with a small bridge added (`src/editor/runtime.ts`). It
holds every scene, and it compiles the lecture text in the browser, which the compiler can do
because it never reads files. `lysark editor-build` builds it. Course CI (`lysark site`) publishes
it with the lectures at `<course site>/_lysark/editor/`, built from the engine version the course
pins, so the panel always matches the student file. It takes a few seconds per run. It is never
part of a student file.

**The extension** (`extension/`) is a thin host. It reads `homepage` from the course's
`package.json`, opens a panel that shows `<homepage>_lysark/editor/`, sends it the text of
`slides.md`, and turns what the panel reports into text edits. It carries two small pieces of
engine code: the slide splitter, which the compiler uses too so both agree where each slide starts
(`src/compiler/slide-ranges.ts`), and the camera edit (`src/editor/camera-edit.ts`). Engine
changes reach the panel through course CI; a new extension version is needed only when the
messages between the two change.

**The messages** between them:

| From | Message | Meaning |
| --- | --- | --- |
| panel | `ready` | loaded; send the text |
| extension | `source` | a numbered text of `slides.md`, and which slide to show |
| panel | `shown` | showing text number N |
| panel | `accepted` | text N compiles; reloading to show it |
| panel | `error` | text N has an error, so the last good one stays (also in the status bar) |
| extension | `goto` | the cursor moved to another slide |
| extension | `request-view` | the camera button was clicked |
| panel | `slide` | the panel moved to another slide of text N |
| panel | `save-view` | a view to write into a slide of text N |

The numbers matter because the panel's slide numbers count the slides of the text it shows,
which can differ from the file: unsaved edits, or a save the panel refused. The extension keeps
each text until the panel has moved past it, and finds the same slide in the file by its `id:`
and its text. If that slide itself has changed since, it asks you to save first instead of
guessing.

**Security.** The runtime is a public page that shows whatever HTML it is sent, so two locks keep
other websites from using it to run script on the course's `github.io` address. First, its
Content-Security-Policy lets only its own script files run: script in a lecture, such as an
`onclick="…"` attribute, never runs in the panel (no lecture uses one; the student file is not
affected). Second, it accepts text only from VS Code's panels (`vscode-webview://` in desktop VS
Code, `*.vscode-cdn.net` in vscode.dev and github.dev), and from local pages when it is itself
served locally, for testing. The second lock alone isn't enough, because any website can get a
page of its own on `*.vscode-cdn.net`. A refused page shows "Ignored the lecture from …". If
github.dev ever shows that message, it has moved its panels to a new address, and
`src/editor/panel-origin.ts` needs it added.

**Tested in engine CI:** `scripts/check-editor.mjs` serves the course-style build of the runtime,
frames it from a page on another address, sends it the demo lecture, and requires a shown lecture,
a saved view, no errors, and no requests to anywhere else.

## Publishing the extension

- **Build the file:** in `extension/`, `npm ci`, then `npm run package`, which makes
  `lysark-0.1.0.vsix`. Engine CI builds the same file on every push: open the run under Actions,
  and download the `vsix` artifact.
- **Upload:** https://marketplace.visualstudio.com/manage, publisher `simply-wyvern`, then New
  extension, Visual Studio Code, and choose the `.vsix`. The Marketplace scans it for a few
  minutes before it appears.
- **A new version:** raise `version` in `extension/package.json`, build, and use Update on the same
  page.

## Developing the extension

- `npm run test-web -- <course folder>` in `extension/` starts VS Code for the web at
  http://localhost:3000 with the extension loaded from the folder and the course folder opened.
  Saves stay in that browser tab; the files on disk don't change.
- test-web needs a local editor runtime, since the published one only answers VS Code's real
  panels: run `node bin/lysark.mjs editor-build`, serve `dist/editor` (the
  `lysark-editor-runtime` entry in `.claude/launch.json` serves it on port 4173), and put
  `"lysark.editorUrl": "http://localhost:4173/"` in the course's `.vscode/settings.json`.
- `node scripts/check-editor.mjs dist/editor lectures/demo/slides.md` runs the CI boot check on
  a build.
- test-web is pinned to 0.0.80, the last version that runs on Node 20.10; newer versions need
  Node 20.19 or later.

## What the test has to answer

The plan's test installs the extension in vscode.dev from a local HTTPS server first. With the
publisher in place, uploading to the Marketplace is simpler and is the path the course will use
anyway, so the test goes straight there:

1. **github.dev in Firefox:** the install offer from the course's `.vscode/extensions.json`, then:
   does the panel show the lecture (the thin host works), do the cursor and save updates work, and
   does V write the view? Also try the camera button.
2. **Desktop VS Code:** install from the Marketplace and check the same things.

If the panel stays empty in github.dev, the thin host failed, and the fallback in lysark-v2.md
section 5 (the engine bundled into the extension) applies.

## Limits of this version

- **Updates on save, by reloading.** The plan wants slides replaced in place while you type, so
  the camera and reveal step survive. That needs the first piece of the player API (lysark-v2.md
  step 3) and is the next editor change.
- **Images show as grey boxes** with their path; the extension doesn't send image files yet.
- **The 3D view takes the panel's shape.** A narrow panel shows less to the sides than the 16:9
  projector, and the text is cut off. The saved numbers are exact, but judge the framing with the
  panel about as wide as the projector. See the proposal below.
- **One preview at a time**, like the deck's one live scene.
- **Views go into the slide's frontmatter.** Named views in scene files come with the scene file
  format, the next design task in step 3.

## Proposal (not built)

Show the deck at the projector's shape inside the panel: a 16:9 stage, scaled to fit, with bars
around it. Then a saved view, and the text size, look in the panel as they will in the classroom.
The deck has no fixed stage today; it fills the window. So this is its own small engine change,
made before the editor relies on it.
