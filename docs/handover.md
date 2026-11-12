# Lysark — handover

Snapshot for resuming after a context clear. Direction, work order, and the backlog
are in [docs/lysark-v2.md](lysark-v2.md); how the runtime works is in
[docs/lysark-design.md](lysark-design.md); working style and the working agreement
are in the repo-root [CLAUDE.md](../CLAUDE.md).

## Where the project is (2026-11-12)

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

**After step 8, raise with the author** (asked for on 2026-11-09, not to be worked on before):
`slides.md` is getting large and hard to navigate. Every slide starts with a long frontmatter
block before its content, and the content holds syntax such as `<!-- pause -->`. Discuss how
to make the lecture file easier to find one's way in.

Proposals (not built):
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
- From v2.13.1: channel names have the same hole as anchor names had. Measured on v2.11.0: an
  anchored vector's `joints: [constructor]` and a slider's `bind: toString` throw ("reading
  'toFixed'"); a slide's `joints: { constructor: 0.5 }`, a plot's `bind: valueOf` and `idle:` on
  `constructor` skip their "unknown channel" warning and write onto JavaScript's own `Object`.
  Fix: own keys only in the channel lookups by an authored name (src/main.ts: plot and slider
  bind, idle, trajectory; src/engine/slide-engine.ts: joints and a slider's gains;
  src/overlay/anchor-layer.ts: a vector's rows; src/editor/runtime.ts: J's pose code). Small,
  and its own change. The vector's throw happens in the frame loop, so it freezes the deck (next
  proposal).
- From v2.13.1: one bad frame freezes the deck until the page is reloaded. `tick` in
  src/main.ts asks for the next frame only at its end, so an exception anywhere in it leaves
  `ticking` true with no frame coming, and `ensureTicking` never restarts it. Seen on v2.13.0: a
  label on `__proto__` threw in `anchorLayer.update`, and every later slide stayed frozen (0
  frames), in Chromium and Firefox. Fix: catch an exception in `tick`, report it once in the
  console, and keep the loop's bookkeeping right (ask for the next frame, or reset `ticking`), so
  the rest of the lecture still runs in front of the class. Small, and its own change.
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
  joints.ts doesn't list.

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
  channel-binding, camera-merge.
- `src/scene/` — scene-layer (the one persistent renderer), camera-controller,
  **ik** (DLS solver), dispose, **objects** (builds a scene file's objects into a scene;
  their data type is `src/engine/object-types.ts`), **models** (parses STL and GLB files
  for model objects; holds three's loaders, so only decks with models import it),
  model-check (the model file check the build and the panel share; the checks that need no
  parse are `src/compiler/model-types.ts`), model-test-files.js (model files as bytes, for
  tests and the demo's files).
- `src/scenes/` — `arm` (exposes `ik` from v2.10.0), `pendulum`, `agilus` (+ `parseAgilusRobot`, exposes `ik`),
  `agilus-duo` (two robots). One scene's GPU alive at a time. `joints.ts` and `anchors.ts`:
  each scene's joints and anchors for the compiler, which can't load the scenes.
- `src/overlay/` — overlay, anchor-layer (labels + live vector), presenter,
  `widgets/` (slider, plot, curve, path, toggle, transport, compare-curve,
  joints-graph), project.
- `src/main.ts` — wiring: camera, idle, trajectory (playback + IK + traces + all
  the widget factories), debug panel, frame loop.
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

- `npm run dev` — preview the demo · `npm test` — vitest (**431**) · `npm run typecheck`
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
