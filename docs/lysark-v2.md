# Lysark v2

Written 2026-10-13. Replaces the review notes from 2026-10-10, which are archived unchanged in
[archive/lysark-v2-review-2026-10-10.md](archive/lysark-v2-review-2026-10-10.md). Those notes
described `main` and missed the work on the `baneplanlegging-lecture` branch; they remain the
reference for most of the postponed ideas in section 7.

This document sets the direction. [lysark-design.md](lysark-design.md) stays the reference for how
the runtime works (scene lifecycle, motion, the `file://` rules), and this document supersedes it
where the two conflict.

## 1. The problem

The runtime works. The problem is ownership: the code grows faster than the author can follow.
The first real lecture (Baneplanlegging, July 2026) added a `trajectory:` frontmatter block, six
widget types, a two-robot scene, and about 400 lines to `src/main.ts`, all in one day. The commits
were labelled "Framework" and "Baneplanlegging", and the handover called every addition reusable,
but the engine had no place for lecture-specific code. So everything the lecture needed beyond
its Markdown became engine code by default.

v2 fixes this with a boundary (section 3) and a working agreement (section 6), not with more
features.

## 2. Goals and constraints

Goals:

1. Lectures live outside the engine, so one engine serves several courses.
2. Each lecture produces one self-contained HTML file that students download and open offline
   from `file://` on Windows, macOS, and Linux, plus a PDF for reading on a phone and for printing
   to take notes on.
3. A lecture is a folder of plain files: Markdown, scene files, images.
4. Hot fixes during a lecture or a break, from the classroom PC or a phone.
5. A visual scene editor for setting up scenes while building a lecture, usable from any computer
   through github.dev, including the classroom PC.

Constraints:

- Presenting needs no login and no token.
- The classroom PC has a personal login, so the author can sign in to GitHub there to edit. It is
  always online except during a power or network failure.
- Course repos are public.
- Firefox is the author's default browser.
- npm is acceptable but unfamiliar. Setting up a new computer must be easy.
- Students care about interaction: sliders, buttons, orbiting the camera. Slide transitions and
  step-wise reveals don't matter to them.

## 3. The boundary: the lecture folder

The lecture folder format is the contract. The author writes lectures from the format
documentation alone, without reading engine source. Everything behind the format is the engine's
job, and engine changes never require editing existing lectures.

```
course-repo/                  one public repo per course
  package.json                pins the engine by git tag
  package-lock.json           records the engine commit that tag resolved to
  SETUP.md                    how to start writing on a new computer
  .vscode/extensions.json     recommends the Lysark extension (from step 3)
  assets/                     shared across lectures: robots, common images
  lectures/
    03-pid-control/
      slides.md
      images/
      scenes/arm-cell.yaml    from step 3
  .github/workflows/build.yml
```

A lecture folder holds no code until lecture scripts exist (section 7). A lecture picks its scenes
and widgets by name (`scene: agilus`), and the build fails if a name is unknown. Today each deck
has a `deck.ts` that imports its scene modules; `lysark build` generates that file instead, from
the `scene:` names in `slides.md`, so a lecture's file still contains only the scenes it uses. A
lecture without the Agilus doesn't carry its 2.9 MB of meshes.

The engine repo (`adamleon/lysark`) holds the runtime, the scenes, the widgets, the compiler, the
build tooling, the visual editor, and the Lysark VS Code extension. It also keeps the demo deck as
a test lecture, which engine CI builds and checks, so every engine change is tested against a real
lecture before any course pins it.

### Pinning the engine

```json
"lysark": "github:adamleon/lysark#v2.0.0"
```

`package-lock.json` records the commit that tag resolved to, and CI installs exactly that with
`npm ci`. A course gets engine changes only when its pin is updated. Editing the tag in
`package.json` alone, for example in github.dev, has no effect and gives no error, because npm keeps
the commit in the lockfile.

To update or roll back, run the course repo's "Update engine" workflow from the Actions tab and
type the tag. It runs `npm install github:adamleon/lysark#<tag>` in CI and commits both files, so
no computer needs npm for this. A push made with a workflow's built-in token (`GITHUB_TOKEN`) does
not start other workflows, so this workflow then starts the course build as a manual
(`workflow_dispatch`) run, the one kind of start that token may make. That is an ordinary build
run: it waits for any other run and rebuilds every lecture, since `package-lock.json` changed. The
workflow needs permission to write the repo and to start workflows, and it fails if `main` only
accepts changes through pull requests. On a computer with npm, running the same command and
committing both files does the same, and that push starts the build as usual.

### The engine as a package

The engine ships a small command-line tool: `lysark dev [lecture]` and `lysark build <lecture>`.
`lysark dev` without a lecture name serves a list of the course's lectures. The course repo's
`package.json` is then just the pin and two scripts.

Three npm details decide how this is set up:

- A `package.json` lists two kinds of packages: `dependencies`, needed to use the package, and
  `devDependencies`, needed only to develop it. A course that installs the engine from git gets
  only the first kind, so Vite and the compiler's libraries go under `dependencies`.
- If the engine's `package.json` has a `build`, `prepare`, `prepack`, `preinstall`, `install`, or
  `postinstall` script, or a `workspaces` field, npm builds the engine during every course
  install: it clones it a second time, installs all its `devDependencies` there, and runs those
  scripts. That is slow and one more thing that can fail. So the engine has none of these
  (today's `build` script gets another name), and it runs without a build step: the `lysark`
  command is plain JavaScript, because Node refuses to run TypeScript from inside `node_modules`,
  and Vite compiles the engine's TypeScript as it loads it.
- The PDF export and the offline check use `playwright-core`, which downloads no browser. Today's
  `playwright-chromium` downloads Chromium during `npm install` on every new computer and every
  CI run. Engine and course CI install Chromium themselves; laptops never download a browser.

### Where code goes

| Useful in | Goes in |
|---|---|
| Any course | Engine repo |
| Several lectures of one course | The course repo (once lecture scripts exist) |
| One lecture | That lecture's folder (once lecture scripts exist) |

Until lecture scripts exist (postponed, section 7), all code lives in the engine. A feature one
lecture needs is added to the engine as its own deliberate change, never as a side effect of
writing that lecture.

## 4. Ways of working

### Presenting: no login

Open the lecture from the course's GitHub Pages index. What is projected is the student file
itself, the same bytes students download. If the network is down, open a copy saved earlier with
the index page's Download link; it works offline.

### Hot fixes: GitHub's own editors

On a computer, open the course repo in github.dev (press `.` on the repo page), which is VS Code in
the browser. On a phone, use the github.com file editor. Make the fix and commit. CI rebuilds the
lecture you changed and republishes the site; then press F5 in the presenting tab. The URL keeps
the slide number (`#12`), so you return to the same slide. From step 3, the Lysark extension also
shows the fix in a preview in github.dev before you commit.

Press F5 rather than reopening the link. Pages tells browsers to cache files for 10 minutes, and
only a reload checks for a newer version.

GitHub's editors sign in with your GitHub account (github.dev may ask you to authorize it once per
browser), so Lysark never handles logins or tokens.

How fast a fix goes live: today's build-only CI run takes about 40 seconds for two decks and starts
no browser. The steps course CI adds are slower; on the 15-slide Baneplanlegging deck the build
takes about 8 seconds, the offline check 17, and the PDF about a minute. If CI rebuilt every
lecture on every push, a full semester would take well over ten minutes. So course CI rebuilds only
the lectures that changed, and publishes the HTML before it makes the PDF (step 1). A fix should
then be live in about two minutes however many lectures the course has, unless an earlier run is
still going; step 1 measures this.

If a commit breaks a lecture, CI marks the run failed and that lecture keeps its previous version.
The other lectures still publish, so a half-finished draft of next week's lecture never blocks a
fix to today's.

### Building a lecture

From step 3, lectures are written with the Lysark extension (section 5), and writing a lecture
needs no npm:

- **Any computer, nothing installed:** open the course repo in github.dev. The first time in each
  browser profile (every session, if the PC wipes profiles), accept the prompt to install the
  recommended Lysark extension, confirm that you trust its publisher, and authorize GitHub. Open a
  lecture's `slides.md` and open the Lysark preview beside it. Edit the text or use the visual
  editor, save all files (File > Save All), then commit from Source Control.
- **Desktop VS Code with a clone:** the same extension in the desktop app. Cloning needs Git; Node
  is not needed.

On a shared PC, commit before you leave. github.dev keeps uncommitted work in that browser's
storage.

Until step 3 delivers the extension, the preview is `npm run dev` from a clone, as described in
`SETUP.md`:

1. Once per computer: install Node.js LTS and Git (npm needs Git to fetch the engine from its
   tag), clone the course repo (in VS Code: Clone Repository), and run `npm install`.
2. Each time: pull first (in VS Code: Source Control, Sync), because fixes made in github.dev or on
   another computer are not in the clone until you do. Run `npm run dev` and pick the lecture from
   the list; the preview updates on every save. Commit and push when done.

### A lecture that needs a new widget or new scene code

That is engine work, done as its own change under the working agreement (section 6), not while
writing the lecture. From step 3, a scene that only arranges existing robots and objects is a
scene file in the lecture folder, not engine work.

Neither the course repo's `npm run dev` nor the extension's preview shows engine changes in
progress; both use a released engine (the pinned one, or with the bundled fallback, the
extension's own). Instead, clone the engine next to the course repo and run the
engine's dev server on the lecture folder (`npm run dev -- ../ais2105-lectures/lectures/04-x`),
which step 1 makes possible. When it works, tag the engine and update the course's pin.

Until step 2 is done, new engine features are frozen, so a lecture that needs a new scene reuses an
existing one or waits.

## 5. The visual scene editor: a VS Code extension

The visual editor is a VS Code extension built to also run in the browser version of VS Code (a
"web extension"). It runs in github.dev and in desktop VS Code, which runs web extensions too;
step 3's test checks both. A panel beside the text shows the live lecture, and every action in the
panel becomes an ordinary text edit in a lecture file. Text stays the only source of truth: the
edit appears as an unsaved change and undo works. After you save, Source Control shows exactly
what changed, and you commit with the Source Control button using your GitHub login.

The engine is close to ready for this. A prototype bundled today's engine and slide compiler for
the browser without changing any engine code: it compiled the Baneplanlegging lecture in 40–70 ms
and showed the live Agilus scene about half a second after the page started loading (0.34–0.51 s
in headless Chromium). The `file://` rules (no
fetching, everything parsed from strings) are what make this possible.

### The extension is a thin host

The extension itself rarely changes. It opens the panel, reads lecture files, applies edits, and
tells the panel where the cursor is. The engine, the compiler, and the editor that run inside the
panel are loaded from the course's own Pages site, where course CI publishes them, built from the
course's pinned engine. Two things follow:

- The preview always uses the engine version the course pins, so it matches the student file.
- Engine changes reach the editor through course CI, not through a new extension release.

This design is untested. Step 3 starts with a test that checks whether the panel may load scripts
from Pages. If it may not, the fallback is to bundle the engine into the extension, show a banner
when the course pins a different version, and upload a new extension version for each engine
release.

### Publishing the extension

Apart from a test copy served from the same computer (`localhost`), github.dev installs extensions
only from the public VS Code Marketplace. There is no private listing, it can't install an
extension file, and its security policy blocks installing from any other URL, such as a GitHub
Pages site. That policy covers installing; whether the panel may load scripts from Pages is a
separate question, which step 3 tests. So the extension is published publicly, which costs nothing
here: it is only useful together with a Lysark course.

- **Publisher:** a Microsoft account and a Marketplace publisher (its ID can't be changed later).
- **Uploading:** by hand on the publisher's web page; this needs no token. Publishing from CI is
  awkward for now: the usual Azure DevOps tokens are retired on 1 December 2026, and the
  replacements need an Azure subscription or a Marketplace feature that isn't switched on yet. With
  the thin host, uploads are rare, so a manual upload is fine.
- **Updates:** a new version appears a few minutes after upload, once the Marketplace's automatic
  scan passes. Desktop VS Code then updates installed copies on its own after a two-hour hold
  (only publishers such as Microsoft and GitHub skip it); pressing Update skips the wait. Whether
  github.dev applies the hold, and how often it checks, is not documented.
- **Installing:** the course repo's `.vscode/extensions.json` recommends the extension, so
  github.dev offers it a few seconds after the repo opens: click Install, then confirm that you
  trust the publisher. The install belongs to that browser profile. Settings Sync
  can carry it to other browsers. A classroom PC that wipes browser profiles asks again each
  session.

### Preview and editing

- **Live preview.** The panel recompiles the lecture as you type. While the text is invalid it
  keeps showing the last valid version, with the error. The panel follows the cursor to the slide
  being edited, and clicking a slide in the panel moves the cursor there.
- **Writing edits.** Scene files are YAML (section 8), like each slide's frontmatter.
  Writing "into the current slide" means into that slide's frontmatter block, found by its `---`
  fences as the compiler finds it. Values are changed through the `yaml` library's low-level API
  (the CST API, for concrete syntax tree), which works on the file's exact text and returns it
  byte for byte except for the edited value. Comments, alignment, and hand-written styles such as
  `{ omega: 5, zeta: 1.0 }` survive. A new entry, such as a new named view, is inserted as new
  lines. The library's higher-level document API is not used for write-back: it keeps comments
  but reformats lines nobody touched (indentation, spacing, `[0, 1]` written as `[ 0, 1 ]`).

Build order, each item useful on its own:

1. **Live preview** with cursor following, as above.
2. **Save a camera view.** Orbit to a view, press a key, and the view is written into the scene
   file as a named view, or into the current slide.
3. **Pose the robot.** Set joints with sliders, or drag the tool and let IK solve the joints. Save
   as a named pose.
4. **Move and rotate objects** with drag handles.
5. **Add assets** from `assets/` to the scene.

The scene file format is designed in work-order step 3 (section 6), right after the test and
before item 2, since saving a view already writes to a scene file. Its starting point is v1's model: slides
describe what the scene looks like (state, not commands), and state carries forward from slide to
slide within a scene.

### Design rules

These keep the editor buildable in the browser. The first one already matters in step 2:

- **The compiler never reads files.** It returns what it needs, such as image paths tagged with
  their slide, and the caller reads the files: the Vite build for the student file, the extension
  for the preview. This applies to image embedding in step 2. If the compiler read files itself, it
  could no longer run in the browser.
- **The panel compiles from text.** It receives the text of `slides.md` and the scene files and
  compiles them itself. The student build still compiles at build time, so the compiler stays out
  of the student file.
- **The editor talks to its host through one small interface:** read a file, apply an edit, hear
  about changes. The extension is one host. A plain browser page can be another, for developing
  the editor in the engine repo.
- **Slides are replaced without reloading.** Today every save to `slides.md` reloads the whole page
  in `npm run dev`. The slide number survives in the URL, but the camera and the current reveal
  step are lost. The editor writes to the files it is
  showing, so the player must accept new slides in place.

### Known limits

- **Firefox.** In a private window the panel works only in Firefox 140 or later (ESR 140
  included, ESR 128 not), because it needs a browser feature called service workers. A school
  policy that blocks cookies or site data breaks it in any window. Use F1 for the Command Palette,
  since Firefox reserves Ctrl+Shift+P.
- **github.dev is changing.** In October 2026, github.dev links forwarded to vscode.dev/github
  when signed out (signed-in behaviour was not checked). It is the same editor. Expect it to ask
  you to authorize GitHub once in each browser.
- **Keyboard.** VS Code intercepts some shortcuts inside the panel, among them Ctrl+Z, Ctrl+S,
  Ctrl+F, and Ctrl+P. Ctrl+Z pressed in the panel does not undo the panel's edit; click in that
  file's text and press Ctrl+Z there.
- **Unsaved edits.** An edit the panel writes into a file that isn't open becomes an unsaved change
  you can't see. Save all files before committing.

## 6. Work order

Working agreement: each step lands on `main` small enough that the author can run it and
understand it before the next step starts. Each step comes with a short plain-language note in
`docs/` on how it works. Until step 2 is done, no engine features outside the current step;
anything else that comes up is written down as a proposal instead. After that, an engine feature a
lecture needs is its own small change, landed and understood before the lecture uses it.

### Step 0: Documents and branches

- Confirm or change the proposed decisions in section 8. Steps 1 and 3 build on them, and the
  rest of this document assumes them.
- Commit this document and the archived review notes. Both are untracked today, so they exist
  only on this computer.
- Pull the four commits on `origin/baneplanlegging-lecture` that this computer is missing, and
  sort out the uncommitted `package-lock.json` change.
- Merge `baneplanlegging-lecture` into `main`.
- Point `CLAUDE.md` at this document for direction. Keep `lysark-design.md` as the runtime
  reference: the hard constraints in `CLAUDE.md` cite its §4.1, §4.2, and §9, and about 50
  `spec §N` references in the code (comments, test names, and two compiler error messages) cite
  its sections. Mark its outdated parts in place: §9b and §10 describe a GLB pipeline and files
  that were never written (the Agilus meshes are Collada files built into the page as text), and
  the offline file is now `<deck>-offline.html`.
- Correct `handover.md`, which Claude Code reads after a context clear. It says the branch is not
  pushed, the lecture has 8 slides, and there are 84 tests; the branch is pushed, the lecture has
  15 slides, and there are 94 tests. Point it here; its next-step ideas are now in section 7.
- Make section 7 the only backlog. The unbuilt items from `ideas.md` are already listed there;
  archive `ideas.md`. Its other entries are built (the Collada Agilus; the `curve` widget, as
  profile plots) or covered by lecture scripts (`onEnter`/`onLeave`).
- Freeze new engine features until step 2 is done.

### Step 1: The split

- `lysark build` and `lysark dev` work on a lecture folder outside the engine repo, and `lysark
  build` generates each lecture's `deck.ts` (section 3).
- The engine follows section 3's package rules: build tooling under `dependencies`, none of the
  scripts listed in section 3, and `playwright-core`.
- Tag the engine `v2.0.0` (the repo has no tags yet).
- Create the course repo with Baneplanlegging as its first lecture folder, pinned to `v2.0.0`. Its
  scenes and widgets stay in the engine for now.
- Keep the demo deck in the engine repo as the test lecture. Engine CI builds it with `lysark build`
  and runs the offline check on it.
- Write `SETUP.md` in the course repo for the `npm run dev` route (section 4).
- Add the "Update engine" workflow to the course repo (section 3).
- Course CI, on every push and when the Update engine workflow starts it:
  - Rebuild only lectures that changed: a lecture is rebuilt when its folder changed, and every
    lecture is rebuilt when `package-lock.json` or `assets/` changed. The site records which
    version of each lecture it holds, and unchanged lectures are copied from the live site.
  - For each rebuilt lecture: build the student file, run the offline check, and publish. Then
    build its PDF and publish again, so a run's PDFs never delay its own fix.
  - A lecture that fails keeps its previous version, and the others still publish.
  - Runs wait for each other instead of overlapping, so a push made while an earlier run is still
    going waits for it.
- The Pages index lists each lecture three ways: Open, for presenting; Download, an
  `<a download>` link to the same file, so students save the exact bytes the offline check tested;
  and the PDF. A plain link only opens the page, and Save Page As in Firefox or Chrome (in its
  default "complete" mode) saves the page as the deck's script has rebuilt it, not the original
  file.
- Turn Pages on once in the course repo's settings (Pages, Source: GitHub Actions). The July
  attempt in the engine repo failed at `actions/configure-pages`, the step that fails when this
  setting is off.

Done when a typo fixed in github.dev appears on the Pages link after a reload within about two
minutes of the commit, measured, and a second computer has been set up from `SETUP.md` alone.

**Status: done on 2026-10-14.** The author's github.dev fix was live 64 seconds after the commit
(build and offline check 18 s); the PDF followed at 199 s. The second-computer check is deferred:
the author has only one PC for now, and judged it not critical. Run it when a second computer is
available, and fix `SETUP.md` wherever it falls short.

### Step 2: Images and the print PDF

- Embed images at build time. A missing file or a web URL fails the build with a message that
  names the slide. The compiler only reports the image paths; the build reads the files (section
  5, design rules).
- A light print variant, used only by the PDF build: white page and 3D background, dark text, and
  plot colors that show on white. Today's PDF is screenshots of the dark theme, so every page
  prints near-black. This needs the 3D background and plot colors read from one place instead of
  being hardcoded in several source files. It is the one piece of the postponed theme work that
  goal 2 needs.

How it works: [step-2-images-print.md](step-2-images-print.md).

**Status: done on 2026-10-15**, released as engine `v2.1.0`. The author moved the course to it
with the Update engine workflow, its first real use, and the published PDF is light. Images were
tested in a copy of the course: a PNG, a JPEG, and an SVG in `assets/`, one of them used on two
slides, went through the real publishing logic against the live site. Each was stored once, the
file passed the offline check, and all three rendered.

### Step 3: The extension and the visual editor

- **Test first.** Build a minimal extension that shows the Agilus in a panel, saves one camera
  view as a text edit, and tries loading its code from a Pages URL. Try it in vscode.dev in Firefox
  on your own computer (installed with "Developer: Install Extension From Location..." from a small
  HTTPS server on `localhost`, as VS Code's web-extension guide describes; this needs Node) and in
  desktop VS Code. Then create the Marketplace publisher (settle its ID first, section 9), upload
  the test extension, and try it in github.dev on the classroom PC, including the install prompt
  from `.vscode/extensions.json`. The result decides between the thin host and the bundled
  fallback (section 5).
- Design the scene file format (section 5).
- Course CI publishes the panel's code (engine, compiler, editor) to Pages with the lectures,
  built from the pinned engine. This is only needed for the thin host.
- Build the editor in the order of section 5.
- Before each editor feature, move out of `src/main.ts` only the functions that feature needs to
  control the running deck. The first piece replaces the slides in place without reloading
  (section 5, design rules). Then come reading and setting the camera for saved views. This set
  of functions (the player API) grows one editor feature at a time, instead of as one large
  refactor up front.
- Rewrite `SETUP.md` for the extension: github.dev with nothing installed, or desktop VS Code with
  a clone and no Node.

## 7. Postponed

Each item waits until a real lecture needs it. Details are in the archived review notes, except
where noted.

- **Live mode:** present from source compiled in the browser, so fixes appear in seconds instead
  of about two minutes. Build it only if the CI delay hurts in practice. The extension's preview
  already compiles in the browser, so live mode would cost little more. It would project something
  other than the student file, so building it reverses the same-bytes decision in section 8. New in
  this document.
- **Lecture scripts:** TypeScript files with start, frame, and stop functions, which run when a
  step is entered, on every frame, and when it is left. They replace the planned
  `onEnter`/`onLeave` hooks, and with them lecture-specific code moves out of the engine.
- **Authoring format additions:** `scene` blocks tied to reveal steps, labels as state, TikZ-style
  label placement, widgets placed in the text flow.
- **Theme file:** color roles shared by text, math, plots, and 3D, and removing the remaining
  hardcoded colors. The print variant is not postponed; it is part of step 2.
- **Video and audio** built into the lecture file. Step 2 refuses `<video>` and `<audio>` with a
  clear build error; embedding them works the same way as images, but video makes the student
  file large.
- **PDF and browsers:** vector PDF; running the offline check in Firefox and WebKit as well as
  Chromium (cheap to add once the course CI exists).
- **Rendering:** stylized shading, adaptive quality, a lighter KUKA base against the dark ground,
  GLB meshes to shrink the offline file.
- **From the archived `ideas.md`:** plots with static data on scene-less slides; an overlay-only ticker so
  animated widgets keep running on scene-less slides; curves whose parameters sliders change.

## 8. Decisions

Decided by the author:

- Godot is rejected: it needs a separate export per OS, has no built-in LaTeX, makes PDF export
  custom work, and requires installing the editor.
- Presenting needs no login and no token.
- Course repos are public.
- The projected file and the student file are the same bytes.
- The visual editor is a VS Code extension that works in github.dev, so visual edits can be made
  from any computer.
- The extension is published publicly on the VS Code Marketplace, since github.dev can install it
  no other way (section 5).
- The first course repo is `adamleon/ais2105-lectures`.

Proposed in this document and confirmed by the author on 2026-10-13, at the start of step 1:

- Lysark never handles GitHub logins or tokens; editing uses GitHub's own editors.
- The extension is a thin host that loads the engine from the course's Pages site, if step 3's
  test shows that works.
- Writing lectures needs no npm once the extension exists.
- No full visual slide editor. Slide text stays text; only the 3D scene gets visual editing.
- One engine repo, not one repo per engine module.
- Scene files are YAML, and scene state carries forward from slide to slide.

## 9. Open questions

- Marketplace publisher ID. It becomes part of the extension's ID and can't be changed later; the
  display name can. The author creates it when step 3's test needs it.
- Whether the classroom PC wipes browser profiles between sessions; if it does, the extension has
  to be reinstalled each session. (Its Firefox is updated often and private windows aren't used
  for presenting, so the Firefox limit in section 5 doesn't apply there.)
- ~~Is about two minutes from commit to live acceptable for hot fixes?~~ Answered in step 1: a
  github.dev fix was live in 64 seconds, which the author confirmed works as intended. Live mode
  (section 7) stays postponed.
