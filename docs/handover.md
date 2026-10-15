# Lysark — handover

Snapshot for resuming after a context clear. Direction, work order, and the backlog
are in [docs/lysark-v2.md](lysark-v2.md); how the runtime works is in
[docs/lysark-design.md](lysark-design.md); working style and the working agreement
are in the repo-root [CLAUDE.md](../CLAUDE.md).

## Where the project is (2026-10-15)

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
loads the files with CORS instead, checked in CI in Chromium and Firefox under the same
isolation and end to end in `@vscode/test-web --coi`. Waiting on the author: the course
on v2.3.0 (Update engine), the 0.2.0 `.vsix` uploaded, then the check in github.dev
(Firefox) and desktop VS Code. After that: the scene file format, then the editor items
of lysark-v2.md §5.

Proposals (not built):
- From step 2: course CI installs Chromium (~27 s) even when no lecture changed. The
  HTML job could skip the install, and the offline check, when `lysark site` has
  nothing to build.
- From step 3: show the deck in the editor panel at the projector's 16:9 shape
  (letterboxed), so saved views and text size look as in the classroom. The deck has
  no fixed stage today; see step-3-editor-test.md.
- From step 3: in the panel, change slides with history.replaceState instead of a new
  `#n` entry, so browser Back in github.dev doesn't step through preview slides.

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
  on the agilus SceneInstance. Robust for slowly-moving targets (the Lin scenario).
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

11 slides, 3 scenes (arm/pendulum/agilus): title idle wave · PID control + loop
SVG · overshoot slider+plot · anchored `$x_e$` · damping regimes · pendulum ·
agilus intro + joint · scene-less outro. Every milestone's review leaned on it —
keep it green.

## Layout

- `src/engine/` — motion-system (PID/spring + `playback`), slide-engine, scene-
  manager (lifecycle), compile-slides (build-time markdown→objects), time-scaling,
  channel-binding, camera-merge.
- `src/scene/` — scene-layer (the one persistent renderer), camera-controller,
  **ik** (DLS solver), dispose.
- `src/scenes/` — `arm`, `pendulum`, `agilus` (+ `parseAgilusRobot`, exposes `ik`),
  `agilus-duo` (two robots). One scene's GPU alive at a time.
- `src/overlay/` — overlay, anchor-layer (labels + live vector), presenter,
  `widgets/` (slider, plot, curve, path, toggle, transport, compare-curve,
  joints-graph), project.
- `src/main.ts` — wiring: camera, idle, trajectory (playback + IK + traces + all
  the widget factories), debug panel, frame loop.
- `src/editor/` — the editor runtime (step 3): `runtime.ts` (bridge to the VS Code
  panel), `deck-from-source.ts` (stands in for `virtual:lysark-deck`, compiles the
  text in the browser), `camera-edit.ts` (writes a view into a slide, byte for byte),
  `panel-page.js` (the panel's page and the runtime's file list, shared with the
  extension and the CI check). `editor.html` is its build entry.
  `src/compiler/slide-ranges.ts` — where each slide sits, shared by the compiler
  and the extension. `src/scenes/all.ts` — every scene, for the editor.
- `extension/` — the VS Code extension: own `package.json`, esbuild bundle, `.vsix`
  via `npm run package`. Not part of the engine package (`.npmignore`).
- `lectures/demo/` — the engine's test lecture.
- `bin/lysark.mjs` — the `lysark` command (plain JS). `scripts/` — lectures.mjs
  (find/build lectures, dev server), check-offline.mjs, export-pdf.mjs, site.mjs
  (course CI publishing), browser.mjs (playwright-core launch).
- `src/styles.css` — theme tokens in `:root`.
- `vite.config.ts` — reads the lecture from `LYSARK_*` env vars set by the command;
  singlefile build, KaTeX woff2-only. `vite-plugin-lecture.ts` — generated deck
  module + dev lecture picker. `vite-plugin-slides.ts` — `.md` compile.

## Commands

See [step-1-split.md](step-1-split.md) for the full `lysark` command.

- `npm run dev` — preview the demo · `npm test` — vitest (**159**) · `npm run typecheck`
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

## Gotchas worth remembering

- **Testing the extension in the browser pane**: clicks and keys from the pane's
  tools don't reach inside VS Code's webview frames (the panel and the runtime get
  no events), so V can't be exercised there; the camera button in the panel's
  title bar can, since it is workbench DOM. Extension-host `console.log` shows up in
  the page console; the panel's frames don't. The panel goes black whenever the
  pane stops painting (same cause as the rAF pause below). Run test-web with `--coi`
  (the `test-web` script does), or isolation problems like the 0.1.0 one stay hidden.

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
