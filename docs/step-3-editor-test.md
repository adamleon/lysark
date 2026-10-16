# Step 3, the test: the Lysark extension

How the Lysark VS Code extension works. It is the test that starts step 3 of
[lysark-v2.md](lysark-v2.md): a panel beside `slides.md` that shows the live lecture and saves a 3D
camera view into the slide. Written for the author; no engine knowledge needed.

## Using it

1. Open a lecture's `slides.md`: in github.dev (press `.` on the course's GitHub page), or in
   desktop VS Code with a clone.
2. Click the ▷ button in the editor's title bar (**Open Lysark Preview**). The panel opens beside
   the text. The first time for a course, VS Code asks whether to load the course's editor from
   its site (the address in the course's `package.json`); click **Load**. The answer is kept in
   that browser, or in desktop VS Code.
3. **The panel follows the cursor:** click in another slide's text, or jump there (Go to Line,
   a search result), and the panel shows that slide.
4. **The panel updates when you save with Ctrl+S**, or click ▷ again. The whole panel reloads,
   so the camera goes back to the slide's own view. Text with an error leaves the last good version
   showing, with the error in a red box. Auto-save (on by default in github.dev) doesn't update the
   panel, or it would reload at every pause in your typing.
5. **Save a camera view:** move the camera with the mouse, then press **V** in the panel (click in
   the 3D view first) or click the camera button in the panel's title bar. The view goes into that
   slide's `camera:` as `lookAt` and `offset`, rounded to two decimals, as an unsaved change,
   and the panel uses it at once: leave the slide and come back, and the camera returns to it.
   Nothing else in the file changes, so Source Control shows exactly those lines. Ctrl+Z in the
   text undoes it.
   - A slide that looks at an anchor (`lookAt: tool`) keeps it; only `offset` changes.
   - A `distance:` is replaced by the `offset:`.
   - A slide with no `camera:` gets one.
6. Commit with the Source Control button, as for any other edit.

## What the test showed

The first version (extension 0.1.0, engine v2.2.0) framed the editor page from the course site
inside the panel. In github.dev in Firefox the panel stayed empty with `NS_ERROR_DOM_COEP_FAILED`.
github.dev makes its panels *cross-origin isolated* (the `Cross-Origin-Embedder-Policy:
require-corp` header), and a page framed inside such a panel must send headers of its own that
GitHub Pages can't send. The same isolation reproduces locally with `@vscode/test-web --coi`.

What isolation does allow is loading files from another site with CORS, and Pages answers every
request with `Access-Control-Allow-Origin: *`. So since extension 0.2.0 and engine v2.3.0 the
panel's page *is* the editor page: it loads the runtime's script and style files straight from the
course site. The thin host stays: the runtime still comes from the course's site, built from the
course's engine, and the extension doesn't bundle it.

## How it works

There are three pieces.

**The editor runtime** is the normal deck with a small bridge added (`src/editor/runtime.ts`). It
holds every scene, and it compiles the lecture text in the browser, which the compiler can do
because it never reads files. `lysark editor-build` builds it. Course CI (`lysark site`) publishes
it with the lectures at `<course site>/_lysark/editor/`, built from the engine version the course
pins, so the panel always matches the student file. It takes a few seconds per run. It is never
part of a student file. Its `index.html` there is only a list of its files.

**The panel page** (`src/editor/panel-page.js`, shared by the extension and the CI check) loads
those files. The extension reads the site's `_lysark/editor/index.html` for their names each time
it shows the page, since every publish renames them, and for the message version it speaks.
New text that only changes cameras (a saved view, or camera values edited by hand on another
slide) goes into the running deck without loading the panel afresh; anything else loads it
afresh. If the
site can't be reached (it gives up after 15 seconds), the panel keeps showing what it has, or says
in the panel what went wrong, and the notification has a Retry button; saving the file, or
clicking ▷ again, also retries. If the site redirects (a custom domain, say), the extension
follows it.

**The extension** (`extension/`) is a thin host. It reads `homepage` from the course's
`package.json`, shows the panel page, sends it the text of `slides.md`, and turns what the panel
reports into text edits. It carries small pieces of engine code: the slide splitter, which the
compiler uses too so both agree where each slide starts (`src/compiler/slide-ranges.ts`), the
camera edit (`src/editor/camera-edit.ts`), and the panel page. Engine changes reach the panel
through course CI. A new extension version is needed only when the messages between the two
change; both sides carry a message version, and a mismatch shows a message saying which to
update instead of an empty panel. The version also goes up when the way slides are split or the
camera is written changes, since the extension carries its own copy of that code. The first
version of the extension (0.1.0) on a course with a newer engine shows "update the Lysark
extension" in its panel.

**The messages** between them:

| From | Message | Meaning |
| --- | --- | --- |
| panel | `ready` | loaded (with its message version and page number); send the text |
| extension | `source` | a numbered text of `slides.md`, and which slide to show |
| panel | `shown` | showing text number N (after loading, or at once when only cameras changed) |
| panel | `accepted` | text N compiles; the extension loads the panel afresh and sends it |
| panel | `error` | text N has an error, so the last good one stays (also in the status bar) |
| extension | `goto` | the cursor moved to another slide |
| extension | `request-view` | the camera button was clicked |
| panel | `slide` | the panel moved to another slide of text N |
| panel | `save-view` | a view to write into a slide of text N |

The extension sends nothing while the panel loads: VS Code drops or rushes messages sent while it
swaps a new page in, so everything goes after the page's `ready`, and a late `ready` from the
page it replaced is ignored.

The numbers matter because the panel's slide numbers count the slides of the text it shows,
which can differ from the file: unsaved edits, or a save the panel refused. The extension keeps
each text until the panel has moved past it, and finds the same slide in the file by its `id:`
and its text. If that slide itself has changed since, it asks you to save first instead of
guessing.

**Security.** The panel shows the HTML in the lecture text, so its Content-Security-Policy lets
scripts run only from the editor's folder on the course site: script in a lecture, such as an
`onclick="…"` attribute, never runs in the panel (no lecture uses one; the student file is not
affected). Forms are switched off too, so a form in a lecture can't replace the panel. The
runtime takes messages only from VS Code, not from a frame inside the slides, and does nothing
when its page is opened outside VS Code. Text from the course site or the workspace never becomes a
clickable link in a VS Code notification (VS Code would run a command hidden in one).

The panel runs the editor's scripts from the site a repository names, so the first time for each
site the extension asks before loading it, and remembers the answer. Without that, opening a
stranger's repository and clicking ▷ would run code from their site in a VS Code tab (it can't
reach the files or VS Code, but it could draw a fake sign-in). In VS Code's Restricted Mode a
repository's own `lysark.editorUrl` setting is ignored as well; a setting you make yourself
doesn't ask.

**VS Code's default panel styles** (padding around the page, code and image styling) are
removed when the runtime starts, so the panel looks like the student file.

**Tested in engine CI**, in Chromium and Firefox: `scripts/check-editor.mjs` serves the
course-style build of the runtime the way Pages does (`scripts/editor-server.mjs`), and builds the
panel the way VS Code for the web builds one: cross-origin isolated, the page written into a
sandboxed frame with VS Code's API script and default styles, swapped in on load. It plays the
extension and requires: the lecture shown, VS Code's styles gone, a saved view, a new text
accepted and shown after the panel loads afresh, a broken text refused, script in lecture text not
run (inline handler, `javascript:` links, a form), no errors, and no requests anywhere else.
Reintroducing the first version's `window.parent` check makes it fail, as it should.

## Publishing the extension

- **Build the file:** in `extension/`, `npm ci`, then `npm run package`, which makes
  `lysark-<version>.vsix`. Engine CI builds the same file on every push: open the run under
  Actions, and download the `vsix` artifact.
- **Upload:** https://marketplace.visualstudio.com/manage, publisher `simply-wyvern`. The first
  time: New extension, Visual Studio Code, and choose the `.vsix`. Later versions: the extension's
  menu, Update. The Marketplace scans each upload for a few minutes before it appears.
- **A new version:** raise `version` in `extension/package.json`, build, and upload.

## Developing the extension

- `npm run test-web -- <course folder>` in `extension/` starts VS Code for the web at
  http://localhost:3000 with the extension loaded from the folder and the course folder opened,
  cross-origin isolated like github.dev. Saves stay in that browser tab; the files on disk don't
  change.
- To use a local editor runtime instead of the published one: run `node bin/lysark.mjs
  editor-build`, serve it the way Pages does with `node scripts/editor-server.mjs dist/editor 4173`
  (the `lysark-editor-runtime` entry in `.claude/launch.json`), and put
  `"lysark.editorUrl": "http://127.0.0.1:4173/_lysark/editor/"` in the course's
  `.vscode/settings.json`.
- `node scripts/check-editor.mjs dist/editor lectures/demo/slides.md --browser firefox` runs the
  CI check on a build (`--screenshot file.png` saves what the panel shows). Chromium and Firefox
  for it install with `npx playwright-core install chromium firefox`.
- test-web is pinned to 0.0.80, the last version that runs on Node 20.10; newer versions need
  Node 20.19 or later.

## What the test showed in the end

- **github.dev and vscode.dev (2026-10-16), extension 0.2.1 with engine v2.3.1:** the panel shows
  the lecture, and saving a camera view works. The author confirmed both. (Extension 0.2.0 wrote
  the view into the text, but the panel only took it on Ctrl+S, and github.dev's auto-save
  doesn't count as one; 0.2.1 sends it at once.)
- **Desktop VS Code (2026-10-16):** installed from the Marketplace; the camera button writes the
  view into the slide's `offset`. Confirmed by the author.

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
- **Frames in slides don't show in the panel** (a YouTube embed, say): the isolation blocks them,
  and the panel's policy does too.
- **Images for the panel must come as `data:` or `blob:` addresses** when the extension starts
  sending them: the isolated panel blocks an image fetched from the site without CORS.
- **Firefox:** VS Code's own panels (all of them, not only Lysark's) need Firefox 140 or later in
  a private window, and don't work when Firefox blocks all third-party cookies and site data.
- **A course with its own domain** must have that domain in `homepage`: in the browser versions,
  the redirect from the `github.io` address can't be followed.
- **A short blank flash on each save,** while the panel loads afresh; it goes when slides are
  replaced in place.
- **Links to slides work** (`[back to the setup](#3)`); the runtime follows them itself, since
  VS Code's panel would swallow the click.
- **Browser Back in github.dev steps through preview slides:** each slide change in the panel
  adds an entry to the browser's history, as it does in the student file (where it's what makes
  `#12` links work). See the proposals below.
- **The panel needs the course site.** It loads the runtime from the site each time it opens or
  reloads (from the browser's cache when nothing changed). If the site can't be reached, the
  panel says where it tried.

## Proposals (not built)

- Show the deck at the projector's shape inside the panel: a 16:9 stage, scaled to fit, with bars
  around it. Then a saved view, and the text size, look in the panel as they will in the
  classroom. The deck has no fixed stage today; it fills the window. So this is its own small
  engine change, made before the editor relies on it.
- In the panel, change slides without adding browser history: an engine option for the slide
  engine to replace the address's `#n` instead of adding one, with the runtime told about slide
  changes directly instead of through the address. A small player-API change for step 3.
