# The editor host: extension 0.3.0 and engine v2.4.0

Step 1 of [scene-files-proposal.md](scene-files-proposal.md), "finish the thin host". How the
Lysark panel and the VS Code extension work together from engine v2.4.0 on, with messages
version 3. Written for the author; [step-3-editor-test.md](step-3-editor-test.md) describes the
extension as a whole and is still right about everything this note doesn't change.

## What changes for you

- **Real images in the panel.** Images from the lecture folder or the course's `assets/` show
  as themselves instead of grey boxes. An image the course build would refuse (a web address,
  a missing file, an unsupported type) shows as a box, and the panel says which and why.
- **V works over unsaved typing.** The panel reads `slides.md` as it is in VS Code at that
  moment, typing included, and changes only the camera values. If you type in the file in the
  split second between pressing V and VS Code applying it, nothing is written and the panel
  says to try again. If the slide already has that view, the panel says so and writes nothing.
- **Scene Actions…** A new button with a list icon on the panel's title bar (or F1, "Lysark:
  Scene Actions…") shows what the panel can do. Today that's one entry, saving the camera view.
  Later steps add "Save view as…", poses and objects here, with no new extension.
- **The panel follows more than slides.md.** Saving a scene file (`scenes/*.yaml`) with Ctrl+S,
  or creating, deleting or renaming one in VS Code, sends it to the panel too, with `slides.md`
  as last sent: typing in `slides.md` still waits for its own Ctrl+S. Undoing (Ctrl+Z) an edit
  the panel made, or redoing it, shows in the panel at once, as the edit did. Undoing your own
  typing still waits for Ctrl+S, like typing.
- **New images show up.** Adding, deleting or renaming an image the slides use (or its folder)
  in VS Code loads the panel afresh, which reads the images again. So does ▷ when nothing else
  has changed.

## How it works

Until now the extension did the editing: the panel reported a camera view, and the extension
worked out the text change with its own copy of engine code. Every new editor feature would
have needed a new extension on the Marketplace.

From version 3 the editing happens in the panel, whose code comes from the course site with
the engine (lysark-v2.md section 8, decision 6). The extension becomes a plain host that does
five things when the panel asks: send the lecture's files, read a file, list a folder, apply an
edit, and ask you a question. New editor features then arrive with Update engine, like
everything else. 0.3.0 is the last extension release the scene-file steps need.

**The messages** (version 3; `src/editor/host.ts` is the panel's side, `extension/src/extension.ts`
the extension's):

| From | Message | Meaning |
| --- | --- | --- |
| panel | `ready` | loaded, with its message version, page number, and the files it wants besides `slides.md` (`scenes/*.yaml`, `scenes/*.yml`) |
| extension | `source` | numbered files: `slides.md` and those it wants, unsaved typing included, and which slide to show |
| panel | `shown`, `accepted`, `error`, `slide` | as in version 2 |
| extension | `goto`, `request-view` | as in version 2 |
| extension | `request-actions` | Scene Actions… was clicked |
| panel | `read` | send these files, as text with their document version, or as bytes |
| panel | `list` | list this folder |
| panel | `edit` | apply these changes as one edit |
| panel | `ask` | show a list to pick from, or a box to type in |
| extension | `reply` | the answer to `read`, `list`, `edit` or `ask`, with the request's number |

**Saving a view (V):** the panel works out the camera view, reads `slides.md` from VS Code with
its version number, finds the slide it shows in that text (by its `id:` and its text, as
before), and computes the change with the same code the extension used before
(`src/editor/save-view.ts`). It sends the change with the version it was computed on. The
extension applies it only if the document still has that version, and then sends the edited
files back, which put the view into the running deck.

**Images:** before the deck starts, the panel asks the compiler which images the lecture uses,
reads them through the extension, and builds them in as `data:` addresses, as the course build
does for the student file (`src/editor/panel-images.ts`). New text that adds an image loads the
panel afresh, which reads it, as does an image file added in VS Code.

**What the panel may touch.** The panel runs code from the course's site, so the extension, not
the panel, decides what it may do:

- **Only a lecture's `slides.md` in a course** opens in the preview (not a README, and not a
  `slides.md` at the top of the course or outside one), so "the lecture folder" is always a
  lecture's own folder. The `lysark.editorUrl` setting changes only where the editor loads from.
- **Read and list** only inside the lecture folder and the course's `assets/` folder, never
  through a link (on desktop VS Code a link inside the lecture folder could lead anywhere), and
  never a hidden name such as `.git` or `.env` (nor a name with `~` and a digit, which on Windows
  can be another name for a hidden file). Up to 32 MB per file and 64 files per request,
  one request at a time; files that would make one request larger than 64 MB are asked for in
  the next. The files sent with every update are only `<folder>/*.yaml` or `.yml`, up to 64
  files of 1 MB.
- **Change** only the lecture's `slides.md` (the file being previewed) and its scene files
  (`scenes/<name>.yaml` or `.yml`, lower-case names).
- **Create** only a new scene file, `scenes/<name>.yaml`, that doesn't exist yet.
- Each change names the version of the document it was computed on. Edits run one at a time,
  all changes in one edit are checked before any is applied, and the versions are checked right
  before VS Code applies them. (If a new file can't be created after all, VS Code keeps the text
  changes it already made; the panel is told, and Ctrl+Z undoes them.)
  A changed file is an ordinary unsaved change: Ctrl+Z in that file undoes it, and Source Control
  shows it once it is saved (github.dev saves by itself after a moment). A new scene file is
  written at once and shows in Source Control straight away; to remove it, delete it (the
  Explorer's Undo doesn't reach it).
- **Ask** shows the panel's question in VS Code's own list or input box: one at a time, and only
  within ten seconds of your click on Scene Actions… or the camera button (or of answering the
  last question), so the page can't put one up while you type elsewhere. Keys pressed inside the
  panel are the page's to answer with its own dialogs. A question is always titled "Lysark
  preview:", so it can't pass for VS Code's own; its texts can't hold a clickable command (VS
  Code would run one); and the panel checks a typed answer itself, since a check run by the
  extension could hang VS Code.
- A failed request says only what went wrong (not found, no permission), never where the file is
  on the computer, which would name the user.

So even a course site that misbehaved could only read the lecture's files and the course's
assets (and send them to its own site; course repositories are public anyway), edit the slides
and scene files in plain sight, and ask questions in VS Code's own boxes.

**Which versions work together.** Extension 0.3.0 speaks versions 2 and 3: with a course on
engine v2.3.x it works as 0.2.1 did (V works, Scene Actions… says to update the engine). Extension
0.2.x with a course on v2.4.0 says "update the Lysark extension". Hence the release order:

1. Upload extension 0.3.0 to the Marketplace.
2. Wait until it has reached github.dev and desktop VS Code (extensions update themselves; the
   Extensions view shows the version).
3. Tag engine v2.4.0, then run Update engine in the course.

## Tested

- **Engine CI**, in Chromium and Firefox: `scripts/check-editor.mjs` plays the extension's side
  of version 3. It serves `slides.md` with a version number and the lecture's images, and requires,
  besides everything it required before: the images shown; a view saved by V but computed on an
  older version refused, with the panel saying so; a view saved through Scene Actions… written as
  one small change inside the first slide's frontmatter; and no file asked for outside the
  lecture folder.
- **The real extension in VS Code for the web** (2026-10-19), `node scripts/check-extension.mjs
  <editor dir> …`, with isolation on as in github.dev. With this engine: both images (lecture
  folder and `assets/`), the files sent again on saving a scene file, V and Scene Actions… writing
  the view, and undo reaching the panel. With the v2.3.1 editor: V writing the view, and Scene
  Actions… saying to update the engine. Not in CI: its first run downloads VS Code (about 55 MB),
  and the workbench's markup changes between VS Code builds. Run it before an extension release.
- Unit tests for the extension's path rules, image paths and loading, and the view change.

## Limits

- **Letter case of image names.** github.dev, like the Linux build, needs the exact case. Desktop
  VS Code on Windows finds `Arm.png` for `arm.png`, so the panel shows an image the build will
  refuse; the course build then reports it.
- **Scene files are sent but not used yet.** They come into use with step 2 (named views).
- **The panel still loads afresh** for any change but a camera change, as before.
