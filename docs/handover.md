# Lysark — handover

Snapshot for resuming after a context clear. Direction, work order, and the backlog
are in [docs/lysark-v2.md](lysark-v2.md); how the runtime works is in
[docs/lysark-design.md](lysark-design.md); working style and the working agreement
are in the repo-root [CLAUDE.md](../CLAUDE.md).

## Where the project is (2026-11-26)

**v2 is under way.** Step 0 of [lysark-v2.md](lysark-v2.md) is done, and the author
confirmed the section 8 decisions. **Step 1 (the split) is done (2026-10-14):**
lectures live in per-course repos and the engine is a package with a `lysark`
command; how that works is in [step-1-split.md](step-1-split.md). The first course repo is
[adamleon/ais2105-lectures](https://github.com/adamleon/ais2105-lectures), pinned to
engine `v2.0.0`, and published at https://adamleon.github.io/ais2105-lectures/.
The first publish (2026-10-13) passed: HTML live 81 s after the push (HTML job 73 s:
Chromium install 24 s, build + offline check 17 s, deploy 18 s), then the PDF job
109 s. The author's github.dev typo fix was live 64 s after the commit. Still open
from step 1: setting up a second computer from the course's `SETUP.md` alone,
deferred until the author has one (not critical).

**Step 2 (images and the print PDF) is done (2026-10-15)**, released as engine
`v2.1.0`; how it works is in [step-2-images-print.md](step-2-images-print.md). Images
referenced from slides are built into the lecture file; the PDF uses a light print
theme, and theme colours come from the CSS tokens (see the colour rule in CLAUDE.md).
The course runs `v2.1.0`: the author moved it with the Update engine workflow (its first
real use), and the published PDF is light. The engine feature freeze has ended.

**Step 3 (the VS Code extension and the visual editor) is under way**, at its test;
how it works is in [step-3-editor-test.md](step-3-editor-test.md). The extension
(`extension/`, Marketplace publisher `simply-wyvern`, ID `simply-wyvern.lysark`) is
a thin host: its panel page loads the editor runtime's files (`src/editor/`, built by
`lysark editor-build`) from `<site>/_lysark/editor/`, where course CI publishes them.
The panel follows the cursor, reloads on save, and saves a camera view into the slide's
frontmatter (V in the panel, or the camera button in its title bar). The first version
(0.1.0, engine v2.2.0) framed the site's page and failed in github.dev in Firefox
(`NS_ERROR_DOM_COEP_FAILED`: github.dev isolates its panels); 0.2.0 with engine v2.3.0
loads the files with CORS instead, and the author confirmed the preview shows in github.dev
and vscode.dev (2026-10-16). A saved view only reached the panel on Ctrl+S, so leaving
the slide and coming back flew to the old view; 0.2.1 with engine v2.3.1 sends it at once
and the runtime puts camera-only changes into the running deck without reloading.
The author confirmed both in github.dev and vscode.dev (2026-10-16): the test is done
and the thin host stays, and desktop VS Code works too. The scene file format is decided
([scene-files-proposal.md](scene-files-proposal.md), all eight decisions as recommended,
2026-10-16). Its step 1, finishing the thin host, is released (2026-11-03,
[editor-host.md](editor-host.md)): extension 0.3.0 is a plain host (read, list, edit, ask;
messages version 3, and still version 2 for courses on v2.3.x), the editing runs in the panel,
images show in the panel, and V works over unsaved typing. The Marketplace has 0.3.0 (the
author confirmed it works) and the engine is tagged v2.4.0; the course moves to it with the
Update engine workflow (done 2026-11-03: the course runs v2.4.0). Step 2, named camera
views, is released (2026-11-04): engine v2.5.0, no extension change. The course runs v2.5.0,
and the author confirmed it works in github.dev the same day. How to write them is in
[scene-files.md](scene-files.md). The demo lecture has `scenes/arm.yaml` with two views.
Baneplanlegging's camera blocks can now become names (the author's choice). Next: step 3,
Save view as…

What tripped the author up while trying it: the panel updates only on Ctrl+S (github.dev's
auto-save doesn't count), and the two errors hit (a copied slide's duplicate `id:`, and a scene
returning after another scene ran) didn't say what to do. Engine v2.5.1 (2026-11-04): the
panel's hint starts "Ctrl+S in the text updates the preview", and those two errors name the
slides, the line in slides.md and the fix.

Step 3, Save view as… (Shift+V), is built and checked (2026-11-05), released 2026-11-09: engine
v2.6.0, no extension change. The panel opens its own dialog (VS Code's lists may only open right
after a click on the panel's buttons); Scene Actions… offers the same in VS Code's list. The
proposal asked for it to be tried in github.dev before release (a two-file edit and its undo);
the real-extension check does that in VS Code for the web, and the author tried it on
2026-11-09 with steps 4 to 7 (see "Released" below).

Step 4, named poses, is built and checked (2026-11-06), released 2026-11-09: engine v2.7.0, no
extension change. `poses:` in a scene file (a q list in joint order, or a mapping of some
joints), used as `joints: <name>` and a trajectory's `from:`/`to:`; the build checks a list's
length and the joint limits against src/scenes/joints.ts, a table of each scene's joints that a
test keeps in step with the URDF files and the pendulum scene's constants.

Step 5 lands in three parts. 5a is built and checked (2026-11-06), released 2026-11-09: engine
v2.8.0, no extension change. J opens joint sliders in the panel (src/editor/joint-panel.ts), which
move the robot at once; P saves the joints moved into the pose the slide names or into its own
`joints:` block (src/editor/pose-edit.ts), put into the running deck in place. A slide's own
slider now follows its joint (src/main.ts), its own small engine change.

5b is built and checked (2026-11-07), released 2026-11-09: engine v2.9.0, no extension change.
Shift+P, "Save pose as…" (only this slide, an existing pose, a new pose, creating the scene file
if needed), in the dialog Shift+V uses (runtime.ts, openChoiceDialog) and in Scene Actions….

5c is built and checked (2026-11-07), released 2026-11-09: engine v2.10.0, no extension change. A
ring at the robot's tool while the joint sliders are open (src/editor/tool-handle.ts); dragging it
solves the scene's position IK (src/scene/ik.ts) and jogs the joints as the sliders do. The arm
scene now exposes `ik` too. That finishes step 5.

Step 6 is built and checked (2026-11-09), released the same day: engine v2.11.0, no extension change.
`objects:` in a scene file (box, cylinder, sphere, frame, or an invisible point; `at`, `rotate`,
`material`, `parent`), by decision 7 (y up, `at` at the middle of the underside, turns in
degrees, colours as named presets, each a `--object-*` token). The compiler checks them
(src/compiler/scene-files.ts, with src/scenes/anchors.ts, each scene's anchors, kept in step by
a test) and they travel with the deck as data (`Deck.objects`); the scene manager adds them when
a scene is first built (src/scene/objects.ts), each an anchor. In the panel, a change to an
object loads it afresh (from step 7, a new place goes in at once).

Step 7 is built and checked (2026-11-09), released the same day: engine v2.12.0, no extension change.
M in the panel (src/editor/object-handles.ts) shows a ring on each object of the scene: dragging
it moves the object along the floor (with Shift, up and down), and a dot beside it turns the
object about the vertical, to the centimetre and the whole degree. Letting go writes only the
numbers of `at` or `rotate` that changed into the scene file (src/editor/object-edit.ts),
refused if the file has the object elsewhere than the panel shows (unsaved typing). New text
whose objects of the scene on screen differ only in where they are, dragged or typed, goes into
the running scene in place (runtime.ts, `placeObjects`); any other change to an object still
loads the panel afresh. Next in docs/scene-files-proposal.md is step 8, models from `assets/`.

**Released (2026-11-09):** GitHub Actions were off on the author's account from 2026-11-06 (the
education plan had expired), so steps 3 to 7 were checked locally before each push. The plan is
back: engine CI passed on step 7's push (9a63463), and v2.6.0 to v2.12.0 are tagged on their
steps' commits (20675c8, 6bf9cf9, defeca7, defbfbd, 59c2cf9, 74d13a1, 9a63463). The course runs
v2.12.0 (Update engine, then Publish lectures, live 16:34 UTC). The author tried steps 3 to 7 in
github.dev on Baneplanlegging the same day: they work. Two things looked like failures first: a
preview opened before the site was republished still ran v2.5.1 until the page was reloaded (the
panel's hint shows which: from v2.8.0 it ends "J: pose the robot"), and the panel's keys work only
after a click in it (it follows the cursor in slides.md, but keys typed there go into the text;
now in scene-files.md and lysark-v2.md section 5). Next: step 8, models from `assets/`.

Step 8 is released (2026-11-12, below): engine v2.13.0, no extension change.
The author confirmed decision 9 of scene-files-proposal.md (all four parts as recommended) the
same day: `model: <path>` with `unit: mm|cm|m` and `up: y|z`; paths from the lecture folder, as
for images, the file in the lecture folder or the course's `assets/`; at most 5 MB per file; and
a course commit later (below). An object's model is an STL (binary or text) or a GLB without
textures. The compiler checks the text and reports each model with its scene file and line
(src/compiler/scene-files.ts; src/compiler/model-types.ts holds the checks that need no parse,
shared with the build and the panel). The build (vite-plugin-slides.ts) finds each file as it
finds images, checks it (src/scene/model-check.ts, which parses with three's loaders, in Node)
and inlines it once as base64 in the slides module's `models` export; the deck gets a model
loader (src/scene/models.ts, with the loaders) only when a scene it runs has a model
(vite-plugin-lecture.ts, `Deck.models`), so other lectures are unchanged. The scene manager
parses the models before it adds the objects, and src/scene/objects.ts (`fitModel`) stands each
on its `at` (the middle of its bounding box's underside, after `unit` and `up`) with the preset
material and records `userData.middle` for M's ring, for every shape. The panel reads the files
through the host after the images (src/editor/panel-models.ts), with the same checks and a
"Models not shown:" banner; any change to a model object but its place loads the panel afresh.
Refused (each with a message): textures (step 9), data outside the .glb, Draco and meshopt,
skins, GPU instancing, unknown required glTF extensions, Git LFS pointers. A GLB's lights,
cameras, lines, points and animations are left out without a word. The demo has a bracket
(models/bracket.stl, mm, z up) and a tray (models/tray.glb) on the table, made by
scripts/make-demo-models.mjs, and the engine repo now has a `.gitattributes` (`*.stl binary`,
`*.glb binary`). Checked: vitest, build:demo and check:demo, check-editor in Chromium and
Firefox (with a new section on the models), check-extension with this editor and v2.12.0's (so
extension 0.3.0 serves `../../assets/*.stl` to the panel), and the Baneplanlegging build. A review (2026-11-10) then found and fixed: GLB
layouts that got past the checks (a second JSON chunk, a list written as an object, a skin or
GPU instancing on a node alone; what three.js built is now checked too, and the loader may ask
for no other file); letter case above the lecture folder (`../L1/`) and in the name of the
course's assets folder, which Windows let through, now checked all along the path, for images
too; model paths only the panel refused (a name starting with '.', ~ and a digit, a ':', a
link), now refused by the compiler and the build; and `lysark dev` not reloading after a rename
that fixed letter case. Its proposals (a GLB's own colours and the file's own origin at minimum
priority, as they go against decision 7; `unit: in`, one parse per file, a total per lecture,
image paths the panel can't read refused as model paths are, a GPU-memory check in
check-offline before step 9, and step 9's blocker in the released panel's security rules) are
in scene-files-proposal.md, "Proposals from step 8".

**Released (2026-11-12):** v2.13.0 is tagged on 3cd20ba, after engine CI passed on it. The
course runs v2.13.0 (Update engine, then Publish lectures, 08:05 UTC). Timed locally first
(2026-11-10, two independent runs, a 4,999,984-byte binary STL of 99,998 triangles): the build
takes 0.6-0.7 s longer; the student file is 7.9 MB (3.3 MB gzipped) and the model slide's first
frame comes 0.12-0.17 s later; with a GPU the frame rate is unchanged (without one, 100k
triangles drop it to 14-32 fps); each fresh panel page takes 0.25-0.4 s longer with a GPU. The
author then tried a model in the course's `assets/` in github.dev on Baneplanlegging: it shows,
and a save with it is no noticeably slower than without, so the 5 MB limit stays. (The
browser's Network tab showed no read of the file, even on a reload of the page, so it says
nothing about whether github.dev keeps the file.) The PDF shows models: `lysark pdf` waits for
the scene manager, which waits for the models; checked locally on the demo and on a 5 MB
lecture. The course commit of decision 9 followed: `.gitattributes` (`*.[sS][tT][lL] binary`,
`*.[gG][lL][bB] binary`, as SolidWorks writes `.STL` in capitals) and a README "Models" section
(paths, `unit` and `up`, M to move, 5 MB, no Git LFS), whose example was built into
Baneplanlegging and offline-checked. Next: the discussion below.

Engine v2.13.1 (2026-11-12), a fix on its own: an anchor name that is also a member of every
JavaScript object (`constructor`, `toString`, `valueOf`, `__proto__`, …), written in a slide's
`camera: lookAt`, its `anchored:` or a named view's `lookAt`, found that member instead of nothing,
so the "unknown anchor" warning was skipped and the deck threw `getWorldPosition is not a function`
(V in the panel too). The three lookups (src/main.ts resolveCameraPose, src/overlay/anchor-layer.ts
show, src/editor/runtime.ts currentView) now take own keys only (`Object.hasOwn`), as
src/scene/objects.ts and step 7's handles already did; src/overlay/anchor-layer.test.ts covers the
layer. Written on 2026-11-09 as v2.11.1 on branch `claude/vibrant-matsumoto-662c6a` (202e56a),
which waited while Actions were off, and ported onto step 8 unchanged. The compiler already
refuses an object named like that (src/compiler/scene-files.ts).

**Finding one's way in slides.md** (raised after step 8, as the author asked on 2026-11-09):
while scrolling it was hard to tell which slide you are on and where slides meet, and each
slide's settings block dominated its text. After a prototype in VS Code for the web the author
chose (2026-11-13) "Markdown + plugin": `slides.md` stays in VS Code's own Markdown editor, the
settings blocks are folded when the file opens, and Lysark adds no slide list of its own.
Extension 0.4.0 is released (2026-11-14; built from ac0e55d, whose engine CI passed); no engine
change. The author tried it in github.dev on Baneplanlegging the same day: "perfect". How it works, and its
limits: [slide-navigation.md](slide-navigation.md). It works on a lecture's
`lectures/<name>/slides.md` in a Lysark course (or the engine repo) and leaves every other file
alone. A markdown-it plugin for VS Code's Markdown extension blanks the settings blocks of an
open lecture before Markdown reads it, so the Outline, breadcrumbs, Quick Outline and sticky
scroll show only the slides' headings (through a road VS Code doesn't document); each block is
an "imports" folding range, folded by `editor.foldingImportsByDefault`, which the extension
turns on for Markdown; each slide's opening line carries a separator (`slide 4 · ptp`); and
**Lysark: Fold or Unfold Slide Settings** folds or opens them all. VS Code folds the blocks the
first time a lecture opens in an editor and then keeps the folds as left, also on reopening, so
a slide the author adds stays open until folded (the prototype showed this too; folding every
block on every opening is written down as a proposal in slide-navigation.md, "Not built"). While
a new slide is half typed, the blocks of the last text that split into slides are kept where
they still stand (extension/src/slide-blocks.ts, `SlideTracker`), so the blocks after it stay
folded. A text that splits without one of them counts as half typed only if one of their `---`
lines changed sides or the text ends inside an open code fence, so a finished edit such as a
slide put inside a code fence counts at once. A code review and a hands-on test (2026-11-13 and
14) led to the lecture-only rule, plain (not "imports") ranges in a file opened with nothing to
fold, leaving a file opened half typed as it is, that test for half typing, and a fold command
that works with no block on screen and refuses to fold where the plugin is missing. Checked by
vitest and by a new first section of `scripts/check-extension.mjs` (which also types a slide
between two), with this engine's editor and v2.12.0's. Released by uploading the `.vsix` that
engine CI's extension job built to the Marketplace.

Engine v2.13.2 (2026-11-23, pushed and tagged on 101d204), three small fixes v2.13.1 left as
proposals, each its own commit; no format change, no extension change. Channel names: a name
every JavaScript object has (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`)
in a slide's `joints:`, a slider's or plot's `bind:`, `idle:`, a trajectory or an anchored
vector's `joints:` found that member: it threw (the vector's in the frame loop, freezing the
deck), wrote onto JavaScript's own `Object`, or blanked a task-space trajectory's joint graph.
Every lookup of a channel or joint by an authored name now takes own keys only (`channelNamed`
in src/engine/channel-binding.ts, src/scene/ik.ts, and the panel's pose code in
src/editor/runtime.ts), so such a name warns "unknown channel" like a misspelled one; the
compiler's check that a trajectory's ends set the same joints takes own keys too. The frame
loop: an exception in a frame left `ticking` true with no frame coming, so one bad frame froze
the deck until a reload. The loop is now src/engine/frame-loop.ts: it catches an exception in a
frame and reports it as an uncaught one would be (`reportError`: in the console, so `lysark
check` still fails on it, and to the page's error listeners, so in the panel it reaches VS
Code's status bar for 8 s), once per message and at most 20 messages a page; then it asks for
the next frame or stops as before (a settled scene-less slide stops it entirely, §3). An error
with no message (a thrown object without a prototype) can't stop the loop either, and time a
throwing channel leaves unspent in the motion step is dropped (src/engine/motion-system.ts), so
it doesn't run all at once when the throwing stops.
Silent saves: while a view or pose waited for VS Code's answer, V, P, Shift+V, Shift+P and Scene
Actions' saves returned without a word; they now show "A save is still on its way; try again in
a moment." (runtime.ts, `saveInFlight`). Checked: unit tests that fail on the old code, a
scratch lecture stepped in Chromium and Firefox before and after (a slide per bad name; a throw
injected into the frames), and a new section of scripts/check-editor.mjs whose stand-in host
holds back its answer to an edit (`holdEdits`) while the other saves are pressed.

**Step 9, textured models, is built (2026-11-25), not yet pushed or tagged:** engine v2.14.0, no
extension change, in two commits. The author decided it the same day (decision 10 in
scene-files-proposal.md). 9a, the small change textured models wait for
(scene-files-proposal.md, "Proposals from step 8"): src/scene/dispose.ts frees every texture a
material holds (any texture-valued property, and a ShaderMaterial's uniforms) and lines and
points as well as meshes, each geometry, material and texture once however many share it; and
`lysark check` (scripts/check-offline.mjs) records three's GPU counts (`renderer.info.memory`,
geometries and textures) before the first scene, through a setter on `window.__lysark` installed
before the page's scripts, and after every scene has been shown requires the same counts on a
slide without a scene. three r185 keeps one texture of its own for the page from the first lit
frame (`DFG_LUT`, its lighting table, 16 × 16); the check finds it through a lit material's
uniforms and allows exactly it. The demo ends 0 geometries and 1 texture (that table), and
Baneplanlegging 0 and 0 (no lit material: the KUKA's Collada materials aren't three's
physically-based ones). Shown on a scratch copy: with a textured mesh in the stage, the old
dispose.ts leaves one texture per scene and the check fails ("4 textures … a scene left GPU
memory behind"); with the new one it passes. No engine release of its own: it lands with step 9.

9b, `material: file` (scene-files.md, "A GLB's own look"): a model keeps its file's materials and
textures only with `material: file` on its object; without a `material:` line a GLB with textures
stops the build at its `model:` line (write `material: file`, or a colour); on an STL it is a
compile error; with a colour the file's look is left out, as before. The compiler reports each
model's look (`ModelRef.look`: file, preset or default) and the build and the panel check a file
once per unit and look (vite-plugin-slides.ts `readModels`, panel-models.ts). With
`material: file`, src/compiler/model-types.ts (`ownLookProblem`) now (with the answers and
their review, below) requires PNG or JPEG images inside the file, at most 2048 px a side (read
from the PNG's IHDR or the JPEG's frame header, `pngSize`/`jpegSize`, in Node without decoding)
and 16,777,216 pixels in all, counted as the copies the graphics card holds; it refuses KTX2,
WebP and AVIF, an image at an address, a see-through material (BLEND, transmission and what
builds on it; a cut-out MASK material is shown), a material more metallic than 0.6 without a
metallic texture (the stage has no environment map: at metalness 1 the demo's tray shows near
black), a texture the file lacks, and a textured mesh without the texture coordinates it uses;
a required extension must be one GLTFLoader reads. A mesh without a material is shown grey
(three's default would be fully metallic). src/scene/model-check.ts parses the
file without its images (Node has no `<img>`) and checks what was built for a see-through
material too. The route that never fetches (src/scene/models.ts, `fileImages`): a GLTFLoader
plugin's `beforeRoot` turns each image's bufferView into a `data:` address in the parser's JSON,
the loading manager lets exactly those addresses through (`own`; anything else still throws
"asks for another file") and hands every `data:` address to a TextureLoader (an `<img>`), so
GLTFLoader's ImageBitmapLoader (which would fetch a `blob:` address) never runs; an image that
doesn't decode rejects the parse with its name rather than GLTFLoader's console line with the
whole address. With a preset (and in the build's check), the plugin takes the materials'
textures out first, so no image is asked for. Own-look meshes keep `uv`…`uv3`, `color` and
`tangent`; objects.ts `fitModel` leaves their materials. The demo: models/tray.glb now has its
own colours (teal, an orange divider) and models/marker.glb is a 6 cm box with an 80 × 80 PNG
fiducial marker on each face (scripts/make-demo-models.mjs, with `png()` and `jpeg()` added to
src/scene/model-test-files.js), both `material: file` on the objects slide. One check-infra fix
came with it: on Windows, headless Chromium's default GPU start lost every page's WebGL context
once in its first seconds, and with the marker the first scene's shaders linked in that window,
so check:demo failed on three's shader errors; scripts/browser.mjs now names ANGLE's SwiftShader
on Windows (`--use-angle=swiftshader`, the renderer it used anyway), and the loss is gone. Checked:
vitest (522, from 493), tsc, the extension's build and tsc, check-editor in Chromium and Firefox (the
marker's texture an `<img>` from a `data:` address, no `blob:` request; the marker without its
`material:` line named in "Models not shown:"), check-extension with this editor and v2.12.0's
(the released extension 0.4.0's panel shows the texture), build:demo and check:demo (0 requests,
GPU memory back to 0 geometries and 1 texture), the student file in Firefox, Baneplanlegging, and
the PDF (the objects page shows the marker's texture and the teal tray). In the student file the
marker's texture leaves the GPU when the arm scene is put away and is uploaded again when it
comes back (Chromium and Firefox); on a scratch copy whose dispose.ts doesn't free textures,
check:demo fails ("2 textures … a scene left GPU memory behind").

Step 9 then had a code review and a hands-on test with real Blender 5.2 exports (2026-11-26), and
their findings are fixed in more local commits, still not pushed. `jpegSize` read `FF 00` as a
marker with a length, where libjpeg (both browsers) skips it to the next `FF`: a crafted JPEG
hid a 4096 × 4096 frame header behind a 16 × 16 one, passed the build and the panel, and showed
at 4096 in both browsers. It now refuses `FF 00` and the markers libjpeg refuses. A
`metallicFactor` that isn't a number (three takes `"1"` as 1) is refused as a broken file;
`KHR_texture_transform`'s `texCoord` counts only when extensionsUsed lists it, as GLTFLoader
reads it; a JPEG labelled `image/jpg` is read as a JPEG. The panel no longer leaves a file out for
every object when one object's unit or look fails: `loadModels` returns `leftOut` (the objects
refused, as `modelObjectKey`: scene file and name), runtime.ts puts it in
`window.__LYSARK_MODELS_LEFT_OUT__`, and deck-from-source.ts finds those objects in its scene
files and hands them to `modelLoader`, which skips them. (A key by unit and look wouldn't do: the
compiler gives an object without a `material:` line `grey`, so the deck can't tell it from one
with `material: grey`.) check-editor now adds a grey copy of the marker while the marker has no
`material:` line, and requires the copy shown. Messages: the over-5 MB advice for a GLB names
its textures and Blender's Images: JPEG Format; 4096 says how to scale an image down in Blender;
BLEND names the Principled BSDF's Alpha; WebP names Blender's settings, and without a
`material:` line says at once that WebP can't be shown; a left-out `metallicFactor` says
Blender leaves it out at Metallic 1. `lysark check` waited a fixed 450 ms before looking for
three's lighting table, so a lecture whose only lit scene was on one slide and built slower
than that failed the GPU check falsely; it now waits until the scene manager isn't busy, in
both directions (shown on a scratch lecture whose scene builds 1.2 s slower: the old check
fails, the new one passes).

The author answered step 9's questions on 2026-11-26 (decision 10 in scene-files-proposal.md),
and three more local commits build the answers, still not pushed. "Refuse textures" meant
textures over 2048 pixels, as built. A file's textures may have at most 16,777,216 pixels in all,
four 2048 × 2048 (the review had packed 290 flat 2048-pixel PNGs, about 6.5 GB of GPU memory, into
a GLB that passed): model-types.ts (`ownLookProblem`, `MAX_TEXTURE_TOTAL_PIXELS`) counted each
image a material's texture uses once (each copy since the review, below), from the same
headers, and the message names the file, so
`checkModel` and `modelBytesProblem` now take the path, which vite-plugin-slides.ts and
panel-models.ts pass. Cut-out materials (MASK, Blender's alpha clip) are allowed and BLEND stays
refused, its message (`MODEL_BLEND_ADVICE`) now naming alpha clip: a Math node set to Round
between the texture's Alpha and the Principled BSDF's Alpha, as the glTF exporter's docs say.
three r185 cuts the shadow out by itself (WebGLShadowMap's `getDepthMaterial` gives a material
with a map and an alphaTest a depth material with both), but that depth material leaves out the
colour's own alpha, so `parseModel` moves it into the alphaTest (models.ts, `shadowedCutOut`;
a colour cut out entirely is not drawn). Alpha painted on vertices can't be moved so: such a part
casts its whole shadow (scene-files.md says so). The demo has models/sign.glb, a warning sign on
the table: one 80 mm square whose 64 × 64 RGBA PNG's surround is cut out (`png()` in
model-test-files.js writes RGBA with `alpha: true`); check-editor requires a MASK material's
alphaTest to be the file's cutoff, read from the GLB's own JSON. A mesh without a material is
grey: `parseModel` marks a mesh whose material isn't one of the file's (no `materials` entry in
GLTFLoader's `parser.associations`) with `userData[WITHOUT_FILE_MATERIAL]` (object-types.ts), and
`fitModel` gives it the grey preset, made only then; check-editor requires grey exactly there.
The author also approved scripts/browser.mjs's `--use-angle=swiftshader` on Windows (Gotchas,
below), and asked for a switch that lifts the size limits for other kinds of presentations or
testing: first a proposal, then decided the same day and built (decision 11, `limits: off`,
below). Checked:
vitest (539, from 528), tsc, the extension's build and tsc, check-editor in Chromium and Firefox
(the sign's material with alphaTest 0.5, its texture an `<img>` from a `data:` address),
check-extension with this editor and v2.12.0's (extension 0.4.0's panel shows the sign's
texture), build:demo and check:demo (0 requests, GPU memory back to 0 geometries and 1 texture),
Baneplanlegging, and the PDF (the objects page shows the sign cut out to a triangle on the white
page). On scratch lectures in Chromium and Firefox, a 0.6 m cut-out sign casts a triangular
shadow, next to the same sign opaque casting a square one; and a demo copy whose tray has a mesh
without a material shows it grey and passes check-editor. With Blender 5.2: a crate whose
sticker's Alpha goes through a Math node set to Round exports as MASK (cutoff left out, so 0.5)
and shows the sticker cut out to a disc, its shadow round; of the hands-on test's exports,
crate-nomat.glb (a cylinder without a material) now builds and shows grey, crate-decal.glb
(BLEND) gets the new message, and the review's 290-texture file is refused by the total
(1,216,348,160 pixels).

The answers then had a review (2026-11-26), and three more local commits fix what it found,
still not pushed. The total counted each image once, but three uploads an image again for each filter
and wrap its textures read it with (GLTFLoader keeps a texture per image and sampler index and
sets its filters and wraps from the sampler; WebGLTextures uploads once per filter, wrap and
colour space), and again without sRGB where data such as a normal map reads it through a texture
of its own. A 228 kB GLB reading one flat 2048-pixel PNG through 108 samplers passed and would
hold about 2.4 GB; in Chromium a 1024-pixel one read through 40 samplers held 40 WebGL textures
of one image. `ownLookProblem` now counts a copy for each image, sampler settings as GLTFLoader
reads them (`samplerSettings`: a value it doesn't know as glTF's default, a name from Object's
prototype as itself) and colour space; data counts as sRGB only where it reads, uncopied, the
very texture a colour (`COLOUR_TEXTURES`) sets sRGB on. On crafted files in Chromium and Firefox
the count matched three's WebGL textures in eight cases and was one over in the ninth (a normal
map through a turned copy of the base colour's texture, which three happens to copy after
setting sRGB); never under. The message adds "held as 5 copies" and why, naming Blender's
Interpolation and Extension. This changes how the author's limit is counted, not the limit:
decision 10 says so, and the author confirmed it on 2026-11-27. check-editor's "grey exactly where the file
gives a mesh no material" never saw such a mesh (no demo model has one): it now makes a GLB of
a red box with a box without a material on it, serves it as if it were in the lecture folder
(`host.made`), shows it with `material: file` beside the marker's grey copy, and requires the
bare box grey and the other red; with `parseModel`'s marker taken out, it fails. The 9b
paragraph above now states the current checks (it listed MASK and a mesh without a material
among the refusals). Checked: vitest (543, from 539), tsc, the extension's build and tsc,
check-editor in Chromium and Firefox, check-extension with this editor and v2.12.0's,
build:demo and check:demo, Baneplanlegging, and the PDF.

**`limits: off` (decision 11), built 2026-11-26** in four more local commits, not pushed (engine
still 2.14.0, unreleased; no extension change). The author asked for a switch that lifts the size
limits ("its not useful for lectures, but could be used for other types of presentations or
just testing") and chose `limits: off`. A scene file may say it at its top. The compiler
(`readLimits` in scene-files.ts) takes exactly the word off as written, also in a `%YAML 1.1`
file, where a bare off reads as false, and refuses anything else at its line, naming the one
value; the unknown-key message lists 'limits', and 'limit' gets the did-you-mean. Each `ModelRef`
carries `limits: 'on' | 'off'` (a string rather than a boolean: it reads as the scene file writes
it, and as the checks' last argument `'off'` says what it does where `true` wouldn't).
`modelSizeProblem`, `modelBytesProblem` (`ownLookProblem`) and `checkModel` take it last, `'on'`
when not given, and with `'off'` skip only the 5 MB, the 2048 px side and the texture total;
every correctness check stays. The build (`readModels`) and the panel (`contentProblems`) check a
file once per `modelReadWay` (unit, look, limits), so a file shared with a scene file that keeps
the limits is refused at that file's line and still shown for the other (`leftOut`). Found while
building it: text that changes only the `limits:` line changes no object, so the panel would have
put it into the running deck in place without checking the models again; `updateInPlace` now
loads afresh when `limitsChanged` (panel-models.ts) says so, and check-editor fails without it.
For a file over the 32 MB VS Code's editor reads (extension 0.4.0 answers only "larger than 32
MB"), the banner says `the model '…' is larger than 32 MB: VS Code's editor reads at most 32 MB
per file, so the preview can't show it.`, then `The lecture still builds, because its scene file
says limits: off` (since the review, below, `Its size doesn't stop the build, …`), or without the
line `The lecture doesn't build with it either:` and the build's size advice. The messages for the three limits don't mention the line (lectures keep the
limits; scene-files.md documents it). The editor's saves keep the line (a test per save path).
check-editor adds a 5,000,134-byte STL it makes (`overLimitStl` in model-test-files.js) and a
model its stand-in host answers as too large, without and with the line (about 3 s more).
Checked: vitest (570, from 543), tsc, the extension's build and tsc (extension/src unchanged),
check-editor in Chromium and Firefox, check-extension with this editor and v2.12.0's,
build:demo and check:demo (0 requests, GPU memory back to 0 geometries and 1 texture),
Baneplanlegging (build and check, 0 and 0), and the PDF (12 pages, as before). Hands-on, on
scratch lectures: a 40,145,808-byte GLB (557,568 triangles)
under `limits: off` builds (a 54.7 MB student file), passes `lysark check` (0 requests, GPU memory
back to 0 geometries and 1 texture) and shows from `file://` in Chromium and Firefox; without the
line the build stops at its line ("the model is 40.1 MB"); in VS Code for the web with extension
0.4.0 (check-extension's pinned build, a one-off run), the panel shows a 6 MB STL of the same
lecture and names the 40 MB GLB with the new words. Next: once the author has seen how the total
is counted (decision 10), push, let engine CI pass, tag v2.14.0, and move the course with Update
engine (the course has no `model:` lines, so the new stop for a textured GLB without `material:`
breaks nothing); the author can then try a textured GLB from Blender in github.dev, and
`limits: off` on a presentation that isn't a lecture.

**The `limits: off` review (2026-11-26)** found no way past the limits and no blocking bug, and
seven more local commits fix what it did find, not pushed. The panel's 32 MB line with the line
said "The lecture still builds", which the panel can't know: it never reads the file (the build
may still refuse it, a see-through material say), and another scene file showing the same file
may keep the limits, where the build stops. It now says `Its size doesn't stop the build,
because its scene file says limits: off`, and names such a file once, as for the host's other
reasons: at the first object whose scene file keeps the limits, or else at the first. A
`limits: off` in a scene file without models (only views, say) while another file with the same
base has the objects, with models that keep the limits, lifted nothing without a word;
`readSceneFiles` now refuses it there and names that file. `limits:` written under an object
says it is a line of the scene file. Past about 400 MB of models in all the build died with
Node's `ERR_STRING_TOO_LONG` and no line; `readModels` now adds up the sizes on disk and stops at
the model's line before base64 would pass Node's `MAX_STRING_LENGTH`, where it could only fail
(`MAX_MODELS_BYTES`). A new test file, `vite-plugin-slides.sizes.test.ts`, tells the plugin
larger sizes for small files (`statSync`) and notes what it reads, so it needs no large file; it
also pins that a file over 5 MB is never read when an object with the limits off comes first
(a mutation of that survived before). A scene file's YAML error no longer ends "at line 7,
column 1:" (from before step 9). Comments and scene-files.md say "unit, look or limits", and
scene-files.md's example gives the right line. scene-files-proposal.md lists the first three
under decision 11 for the author; the rule itself is unchanged. `limitsChanged` in runtime.ts is
still checked only by check-editor, which fails without it (runtime.ts needs the browser).
Checked: vitest (576, from 570), tsc, the extension's build and tsc (`extension/` unchanged),
check-editor in Chromium (49 s) and Firefox (44 s), check-extension with this editor and
v2.12.0's, build:demo (4,276.47 kB) and check:demo (12 slides, 0 errors, 0 requests, GPU memory
back to 0 geometries and 1 texture), Baneplanlegging (15 slides, 0 and 0), and the PDF (12
pages at 3200 × 1800, as before). Hands-on with `lysark build`: a 410 MB file under `limits: off`
stops in 140 ms at its line, and a misplaced line and one under an object give their messages.

**Step 9 released (2026-11-27).** All of it was pushed, engine CI passed, the author confirmed
counting copies (decision 10) and saw the review's additions to `limits: off` (decision 11), and
it is tagged `v2.14.0`. Next: the author moves the course with Update engine (the course has no
`model:` lines, so nothing in it changes) and tries a textured GLB from Blender in github.dev.

Proposals (not built):
- From step 9's hands-on test: entering the pendulum scene logs about 45 `THREE.WebGLShadowMap:
  … has no shadow` warnings (in the demo too). src/scenes/pendulum.ts sets `castShadow` on every
  node under its root, the stage's lights included, and three warns for a light without a
  shadow; setting it on meshes only would end them. Warnings, so `lysark check` passes.
- From step 2: course CI installs Chromium (~27 s) even when no lecture changed. The
  HTML job could skip the install, and the offline check, when `lysark site` has
  nothing to build.
- Editor panel aids (the author, 2026-11-09), after the scene-file steps: hide the slide
  text (H), and the classroom 16:9 shape as a toggle (C), which replaces step 3's always-on
  16:9 proposal. In lysark-v2.md section 7, with what each touches.
- Slide editing in the panel (2026-11-09): what of PowerPoint fits, in
  slide-editing-proposal.md. Future proposals fit "slide text stays text"; visual editing
  of slides is at minimum priority.
- From step 3: in the panel, change slides with history.replaceState instead of a new
  `#n` entry, so browser Back in github.dev doesn't step through preview slides.
- From v2.13.1: check anchor names at build time. A string `lookAt` (a slide's `camera:`, a
  named view) and each `anchored:` entry's `anchor` must name an anchor of the slide's scene:
  the engine scene's anchors in src/scenes/anchors.ts (for a scene file, those of its `base`)
  plus the scene file's object names. Otherwise the build fails with the line, the closest name
  and the list, as an unknown view or pose does. A view is checked in its own file
  (src/compiler/scene-files.ts), a slide against the scene it names (compile-slides.ts); the
  compiler has all it needs (`SceneFile.base`, `SceneFile.objects`, `SCENE_ANCHORS`). Why: today
  a misspelled anchor only warns in the browser console, which the panel doesn't show; the
  camera just doesn't move there, or the label stays hidden. In the panel the build error would
  show in its red box. No lecture breaks: the demo uses end_effector, grip (an object), bob and
  tool0, and Baneplanlegging uses tool0. Like decision 8 it turns a warning into a build error,
  so it is the author's call. The same check could cover channel names against
  src/scenes/joints.ts, once it is settled how to treat agilus-duo's `ghost_` channels, which
  joints.ts doesn't list. It would also catch `__proto__` as a name in `joints:` or `idle:`,
  which the compiler drops without a word today (since v2.13.2 the runtime warns about every
  other such name).
- From v2.13.2: show the running deck's errors in the panel. An uncaught error in the panel's
  page, such as a frame that throws, reaches VS Code only as an 8-second status-bar message
  (runtime.ts's window `error` listener posts a non-fatal `lysark:error`; extension.ts shows it
  with setStatusBarMessage), and the frame loop reports each message once a page, at most 20.
  So an error thrown on every frame of one slide is said once, for 8 s; after that the slide
  runs with the rest of each frame skipped (labels or plots stand still, say) and nothing on
  screen says why, and the same message on a later slide isn't said again. Fix: the panel
  shows a non-fatal error in its banner, with the slide it happened on, and the frame loop
  forgets what it reported when the slide changes, so each slide's error is said once. Editor
  runtime and engine only, no extension change; the author's call, because the banner is the
  panel's one message line and the saves use it.

The **framework** (M1–M7 + theme + Agilus mesh) is complete. On top of it, the
**first real lecture** — *Baneplanlegging* (trajectory planning, AIS2105, Norwegian)
— has 15 slides, and drove a set of framework additions (kinematic trajectory
playback, numeric IK, several plot/transport widgets, a two-robot comparison scene).
The lecture now lives in the course repo at `lectures/baneplanlegging/slides.md`.

Milestones M1–M7: motion (PID torque joints, spring-damper camera, settle) ·
markdown+frontmatter slide engine · scene lifecycle (multi-scene, suspend/restore,
snapshot crossfade, scene-less) · anchored overlays + uPlot plots + declarative
idle · three build targets (classroom / single-file offline / Playwright PDF) ·
presenter polish. Theme: red/green/cheese CSS tokens. Agilus: real KUKA KR 6 R900-2
URDF + Collada meshes, runs from the offline file with no fetch.

Each milestone ended with an adversarial multi-agent review (`git log`); worth
continuing for substantial changes.

## The Baneplanlegging lecture — 15 slides, Norwegian (course repo: `lectures/baneplanlegging/slides.md`)

Built out to full parity with the source pptx (`AIS2105/.../Baneplanlegging.pptx`):
equation-rich, and **presenter-facing** — the lecturer drives the live scenes, so
every student-directed "drag/click here" instruction was removed. To work on the
engine against it, clone the course next to the engine and run
`npm run dev -- ../ais2105-lectures/lectures/baneplanlegging`. Scene runs: `agilus` (1–5), scene-less theory (6–10),
`agilus` again (11–14, resumed after the gap — see the contiguity gotcha), then
`agilus-duo` (15).

1. **tittel** — title, idle sweep.
2. **konfigurasjon** — joint sliders + live anchored `q`-vector; adds the config
   equation q∈𝒞⊂ℝⁿ and forward kinematics x=f(q).
3. **bane** — path q(s):[0,1]→𝒞 (formal def), `s` slider scrubs the robot. No time.
4. **ptp** (PTP/MoveJ) — joint-linear q(s)=s·q_f+(1−s)·q₀; gold tool curve,
   `jointgraph` = **straight lines**.
5. **lin** (Lin/MoveL) — task-linear x(s) via IK; `jointgraph` = **curved**; bridges
   to the SE(3) theory (orientation must also interpolate).
6. **translasjon-rotasjon** *(scene-less)* — SE(3): t(s) linear, R(s)=R_A·exp(log(R_AᵀR_B)s).
7. **matriseeksponent** *(scene-less)* — eᴬ=Σ Aⁿ/n!, tie to ẋ=Ax.
8. **rotasjonsmatrise** *(scene-less)* — angle-axis exp, skew matrix, Rodrigues.
9. **rute** *(scene-less)* — bane+tid=rute; time scaling s(t) + chain rule for q̇,q̈.
10. **kubisk-utledning** *(scene-less)* — cubic general form → boundary conditions
    (a₂=3/T², a₃=−2/T³) → 3(t/T)²−2(t/T)³. (Fixes the pptx's s̈=2a₂+6a₃ → +6a₃t.)
11. **kubisk** — robot runs cubic; `curve` shows s̈≠0 at ends (geometrisk, ikke fysisk glatt).
12. **trapes** — trapezoidal profile (piecewise-constant s̈); `curve` widget.
13. **s-kurve** — S-curve (7-phase bounded-jerk); `curve` widget. New engine profile.
14. **femteordens** — quintic; general form + closed form; s̈=0 at ends (fysisk glatt).
15. **sammenligning** — TWO overlaid robots (white cubic + green ghost quintic);
    `transport`, `compare` graph, `toggle`.

Note: cubic vs quintic only diverge ~5 % along the path — the overlay reads best in
motion. PTP↔Lin verified numerically: PTP tool bulges 0.52 m off the chord, Lin
tool stays within 0.7 mm of the line. The pptx's rendered-equation slides 6–8 and
14–16 became the scene-less theory slides + the profile demos here.

## Framework capabilities the lecture added (all reusable, unit-tested, file://-safe)

- **Lecture folders** (since v2 step 1): a lecture is a folder with a `slides.md`.
  `vite-plugin-lecture.ts` generates its deck module (`virtual:lysark-deck`) from
  the `scene:` names, importing only those scenes from `src/scenes/registry.ts`.
- **Time-scaling** ([src/engine/time-scaling.ts](../src/engine/time-scaling.ts)):
  `cubic`/`quintic`/`trapezoidal`/`scurve` as pure `s(t)→{s,ṡ,s̈,⃛s}`, plus a
  `PROFILES` map. `scurve` = 7-phase bounded-jerk (accel is a trapezoid, a(0)=a(T)=0,
  finite jerk everywhere); parameterized by jerk/accel fractions, unit-jerk shape
  integrated analytically and scaled to land s(1)=1. `ProfileName` is the one source
  of truth (slide-types/compiler/main import it; compiler derives PROFILE_NAMES from
  `Object.keys(PROFILES)`).
- **Kinematic playback**: `PidChannel.playback = {x,v}` replays an exact pose,
  bypassing PID (no lag). Cleared to resume PID control.
- **`trajectory:` frontmatter** (main.ts drives it): multi-joint `from`/`to` poses;
  `control: auto` (ping-pong loop) / `slider` (manual `path` widget) / `time`
  (transport run+scrub); `space: joint` (PTP) / `task` (Lin, IK to a point on the
  straight line each frame); `profile`; `compare` (2nd profile on `ghost_*` channels
  for agilus-duo); `trace: [joint,task]` (draws reference tool paths as THREE.Line in
  a `trace-layer`). Eases to q₀ under PID first (`trajArmed`), then engages playback.
- **IK** ([src/scene/ik.ts](../src/scene/ik.ts)): numeric position-only damped-least-
  squares over a geometric Jacobian, warm-started. Exposed as `ik` (fk/solve/get/set)
  on the agilus and (from v2.10.0) arm SceneInstances: MoveL, task-space trajectories and
  traces, and the editor's tool drag, which steps it with src/editor/tool-handle.ts
  `stepToward`: aims of at most 3 cm, the elbow held bent the way it is as a bound of the
  solve (each scene names its elbow, shoulder and wrist; ik.ts finds the straight angle), joints
  at a stop set aside (`stopsAside`), and the spare joints leaning back in the null space to
  the pose before dragging (`rest`). MoveL uses none of these options. Robust for
  slowly-moving targets (the Lin scenario).
- **Widgets** (`src/overlay/widgets/`): `curve` (analytic profile plot + phase
  marker), `path` (s slider), `toggle` (solid/ghost swap), `transport` (Run/Pause +
  normalized-time scrub), `compare` (one selectable quantity for two profiles), and
  `jointgraph` (q(s) per driven joint). All uPlot, marker = a DOM line in `.u-over`.
- **Scenes**: `agilus` refactored to export `parseAgilusRobot()`; `agilus-duo`
  (two overlaid robots, `setSolid(i)` swaps solid vs. green translucent ghost —
  the ghost is scaled 0.99 + `polygonOffset` so coincident poses read white, not
  green). agilus default gains critically damped (kd 7 → no wobble at rest).
- **Live config-vector** anchored variant (`anchored: … vector: {joints,…}`).

## The demo lecture — regression showcase ([lectures/demo/slides.md](../lectures/demo/slides.md))

12 slides, 3 scenes (arm/pendulum/agilus): title idle wave · PID control + loop
SVG · overshoot slider+plot · anchored `$x_e$` · damping regimes · objects from the
scene file (two of them models from `models/`, written by `scripts/make-demo-models.mjs`) ·
pendulum · agilus intro + joint · scene-less outro. Every milestone's review leaned on it —
keep it green.

## Layout

- `src/engine/` — motion-system (PID/spring + `playback`), slide-engine, scene-
  manager (lifecycle), compile-slides (build-time markdown→objects), time-scaling,
  channel-binding (and `channelNamed`, the lookup by an authored name), camera-merge,
  frame-loop.
- `src/scene/` — scene-layer (the one persistent renderer), camera-controller,
  **ik** (DLS solver), dispose, **objects** (builds a scene file's objects into a scene;
  their data type is `src/engine/object-types.ts`), **models** (parses STL and GLB files
  for model objects; holds three's loaders, so only decks with models import it),
  model-check (the model file check the build and the panel share; the checks that need no
  parse are `src/compiler/model-types.ts`), model-test-files.js (model files as bytes, PNGs and
  JPEGs too, for tests and the demo's files).
- `src/scenes/` — `arm` (exposes `ik` from v2.10.0), `pendulum`, `agilus` (+ `parseAgilusRobot`, exposes `ik`),
  `agilus-duo` (two robots). One scene's GPU alive at a time. `joints.ts` and `anchors.ts`:
  each scene's joints and anchors for the compiler, which can't load the scenes.
- `src/overlay/` — overlay, anchor-layer (labels + live vector), presenter,
  `widgets/` (slider, plot, curve, path, toggle, transport, compare-curve,
  joints-graph), project.
- `src/main.ts` — wiring: camera, idle, trajectory (playback + IK + traces + all
  the widget factories), debug panel, the frame (run by src/engine/frame-loop.ts).
- `src/editor/` — the editor runtime (step 3): `runtime.ts` (bridge to the VS Code
  panel), `deck-from-source.ts` (stands in for `virtual:lysark-deck`, compiles the
  text in the browser), `camera-edit.ts` (writes a view into a slide, byte for byte),
  `panel-page.js` (the panel's page and the runtime's file list, shared with the
  extension and the CI check), `joint-panel.ts` and `tool-handle.ts` (J), `pose-edit.ts` (P),
  `object-handles.ts` and `object-edit.ts` (M, moving objects), `panel-images.ts` and
  `panel-models.ts` (the images and models, read through the host). `editor.html` is its build
  entry.
  `src/compiler/slide-ranges.ts` — where each slide sits, shared by the compiler
  and the extension. `src/scenes/all.ts` — every scene, for the editor.
- `extension/` — the VS Code extension: own `package.json`, esbuild bundle, `.vsix`
  via `npm run package`. Not part of the engine package (`.npmignore`).
- `lectures/demo/` — the engine's test lecture.
- `bin/lysark.mjs` — the `lysark` command (plain JS). `scripts/` — lectures.mjs
  (find/build lectures, dev server), check-offline.mjs, export-pdf.mjs, site.mjs
  (course CI publishing), browser.mjs (playwright-core launch), make-demo-models.mjs (writes
  the demo's model files; they are committed, so run it only to change them).
- `src/styles.css` — theme tokens in `:root`.
- `vite.config.ts` — reads the lecture from `LYSARK_*` env vars set by the command;
  singlefile build, KaTeX woff2-only. `vite-plugin-lecture.ts` — generated deck
  module + dev lecture picker. `vite-plugin-slides.ts` — `.md` compile.

## Commands

See [step-1-split.md](step-1-split.md) for the full `lysark` command.

- `npm run dev` — preview the demo · `npm test` — vitest (**576**) · `npm run typecheck`
  (a worktree under `.claude/worktrees/` adds its own copy of the tests to the count; leave it
  out with `npx vitest run --exclude ".claude/**"`)
- `npm run build:demo` → `dist/demo.html` · `npm run check:demo` — Playwright
  file:// acceptance (0 fetch / 0 errors / KaTeX fonts intact). Needs Chromium:
  `npx playwright-core install chromium`.
- `node bin/lysark.mjs pdf dist/demo.html` → `dist/demo.pdf`.
- Against a course lecture: `npm run dev -- ../ais2105-lectures/lectures/baneplanlegging`.
- `node bin/lysark.mjs editor-build` → `dist/editor/` (the editor runtime);
  `node scripts/check-editor.mjs dist/editor lectures/demo/slides.md [--browser firefox]` boots it
  as the panel in github.dev does; `node scripts/editor-server.mjs dist/editor 4173` serves it
  like Pages.
- In `extension/`: `npm run build`, `npm run typecheck`, `npm run package` (→ `.vsix`),
  `npm run test-web -- <course folder>` (VS Code for the web on port 3000).
- `node scripts/check-extension.mjs <editor dir> [<editor dir> …]` — the real extension in VS Code
  for the web against each editor build (by its message version); run before an extension
  release, with this engine's editor and the last release's (`git worktree add <dir> v2.3.1`,
  link `node_modules` with `mklink /J`, `node bin/lysark.mjs editor-build --out-dir <out>` there).
  Remove that link (`rmdir <dir>\node_modules`) before `git worktree remove`: on Windows the
  removal follows it and empties the real `node_modules`.

## Gotchas worth remembering

- **Testing the extension in the browser pane**: clicks and keys from the pane's
  tools don't reach inside VS Code's webview frames (the panel and the runtime get
  no events), so V can't be exercised there; the camera button in the panel's
  title bar can, since it is workbench DOM. Extension-host `console.log` shows up in
  the page console; the panel's frames don't. The panel goes black whenever the
  pane stops painting (same cause as the rAF pause below). Run test-web with `--coi`
  (the `test-web` script does), or isolation problems like the 0.1.0 one stay hidden.
  Playwright's own Chromium does reach the panel (scripts/check-extension.mjs).
- **Changing the panel's `INCLUDE` patterns** (src/editor/runtime.ts) in a later engine: the
  extension re-gathers the latest set of files when a new page names other patterns, but if the
  latest text was refused, the page first boots with the last accepted set, gathered under the
  old patterns, until the next accepted text. Harmless while the patterns stay
  `scenes/*.yaml|yml`; if they change, re-gather the accepted set in `onReady` too.
- **test-web keeps saves in the browser tab** (its file system runs in the tab), not on
  disk: read the document from the editor, not the file. A reload or a new tab reads the disk
  again. Its Quick Open doesn't find files created after it started (open them from the
  Explorer).
- **Firefox in engine CI** has no GPU: headless it finds no OpenGL, and its blocklist
  refuses software WebGL 2. The editor check therefore runs Firefox headed under
  `xvfb-run` (Mesa software OpenGL) with `webgl.force-enabled` (scripts/browser.mjs,
  build.yml). CI logs need a GitHub sign-in to read; the editor check also writes its
  failure as a public annotation (readable with the API, no token).
- **Headless Chromium on Windows** (seen 2026-11-25, Playwright's Chromium 1228, an AMD Radeon
  890M laptop): with no flags it renders WebGL with ANGLE's SwiftShader but loses every page's
  context once in its first seconds, and three.js logs `Shader Error … VALIDATE_STATUS false` for
  each program linked meanwhile, so a check fails or not by timing. scripts/browser.mjs passes
  `--use-angle=swiftshader` on Windows, the same renderer without the loss (approved by the
  author on 2026-11-26). To see it, load a student file with `chromium.launch()` alone and listen
  for `webglcontextlost`.

- **Preview tab rAF pause**: the Claude preview tab is backgrounded → `rAF` paused,
  render loop looks frozen, `preview_screenshot` times out. NOT a bug. Verify via
  **Playwright against a built `dist/<lecture>.html`** (rAF runs there) — this is how every visual
  check in the lecture work was done. `window.__lysark` exposes engine, motion,
  sceneManager, cameraCtl, overlay, anchorLayer, presenter, getTrajS, …. The active
  scene's `ik` is reachable at `__lysark.sceneManager.active.ik`.
- **Scene contiguity** (compiler-enforced, relaxed): a scene may now span more than
  one run as long as the runs are separated ONLY by scene-less slides — the runtime
  suspends the scene and restores its serialized state on re-entry (§4.1), which the
  Baneplanlegging deck relies on (`agilus` 1–5 → scene-less theory 6–10 → `agilus`
  11–14). Still forbidden: interleaving two *different* scenes — once another scene
  runs, the previous one is "sealed" and may not reappear (this is why `agilus` still
  can't return after `agilus-duo`). See `sealedScenes`/`lastRealScene` in the compiler.
- **Probe slider selector**: the debug panel's sliders are also `.widget-slider`;
  target a slide widget with `.slide-widgets input[type=range]`, not `.widget-slider`.
- **IK**: position-only DLS, warm-started — accurate for the small per-frame target
  steps of Lin (sub-mm); big single jumps need more iterations. Joint-curve sampling
  for the `jointgraph` runs the IK sweep at slide setup via `ik.getJoints/setJoints`.
- **Mesh pipeline (Collada)**: `.dae` XML → `import …?raw` + `ColladaLoader.parse`
  in a custom `URDFLoader.loadMeshCb`. Traps: (1) real cb signature is
  `(path, manager, material, onComplete)` — the typings drop `material`; (2) hand
  the DAE back un-rotated or links separate at extended poses; faceting → `toCreasedNormals(…, 40°)`.
- **Models in the build** (from v2.13.0): vite-plugin-slides.ts imports
  src/scene/model-check.ts, so the Vite config process loads three and its STL and glTF loaders
  in every build; engine CI's course-style job is what proves they resolve from
  `node_modules/lysark`. To tell whether a built lecture carries the model code, look for
  `THREE.GLTFLoader`, not `STLLoader`: urdf-loader brings STLLoader into every arm or KUKA
  lecture anyway.
- **file:// build**: no runtime fetch / dynamic import / workers-from-URL. The
  `fetch(` left in the bundle (three/urdf-loader) are dead code — `lysark check`
  proves 0 requests fire. The raw 37 MB `assets/kuka_agilus/` is gitignored; only
  `src/assets/agilus/` (~2.9 MB) ships.

## Next steps

Follow [lysark-v2.md](lysark-v2.md) section 6: step 3 (the extension and the visual
editor) is under way. Its test needs the author (see "Where the project is"); then the
scene file format, then the editor items in the order of section 5. When a second computer is available, run step 1's
deferred `SETUP.md` check. The backlog is lysark-v2.md section 7, the only one; the old
`ideas.md` is archived in
[docs/archive/](archive/), and its unbuilt items, plus the mesh polish and GLB ideas
that used to be listed here, are in that section.
