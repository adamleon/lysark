# Lysark — handover

Snapshot for resuming after a context clear. The authoritative spec is
[docs/lysark-design.md](lysark-design.md); working style is in the repo-root
[CLAUDE.md](../CLAUDE.md); the candidate backlog is [docs/ideas.md](ideas.md).

## Where the project is

The **framework** (M1–M7 + theme + Agilus mesh) is complete. On top of it, the
**first real lecture** — *Baneplanlegging* (trajectory planning, AIS2105, Norwegian)
— is built out to 8 slides, and drove a set of reusable framework additions
(kinematic trajectory playback, numeric IK, several plot/transport widgets, a
two-robot comparison scene). All committed on this branch; **not yet pushed**.

Milestones M1–M7: motion (PID torque joints, spring-damper camera, settle) ·
markdown+frontmatter slide engine · scene lifecycle (multi-scene, suspend/restore,
snapshot crossfade, scene-less) · anchored overlays + uPlot plots + declarative
idle · three build targets (classroom / single-file offline / Playwright PDF) ·
presenter polish. Theme: red/green/cheese CSS tokens. Agilus: real KUKA KR 6 R900-2
URDF + Collada meshes, runs from the offline file with no fetch.

Each milestone ended with an adversarial multi-agent review (`git log`); worth
continuing for substantial changes.

## The Baneplanlegging lecture — 15 slides, Norwegian ([src/content/baneplanlegging/slides.md](../src/content/baneplanlegging/slides.md))

Built out to full parity with the source pptx (`AIS2105/.../Baneplanlegging.pptx`):
equation-rich, and **presenter-facing** — the lecturer drives the live scenes, so
every student-directed "drag/click here" instruction was removed. Build/run with
`LYSARK_DECK=baneplanlegging`. Scene runs: `agilus` (1–5), scene-less theory (6–10),
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

- **Multi-deck seam**: one folder per deck under `src/content/<deck>/`
  (`deck.ts` manifest + `slides.md`). `main.ts` imports `@active-deck`, a Vite
  alias resolved from `LYSARK_DECK` (default `demo`) — one static import, only the
  selected deck bundles. Offline/PDF outputs are deck-named.
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

## The demo deck — regression showcase ([src/content/demo/slides.md](../src/content/demo/slides.md))

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
- `src/content/<deck>/` — one folder per deck; `demo/` + `baneplanlegging/`.
- `src/styles.css` — theme tokens in `:root`. `scripts/` — check-offline, export-pdf.
- `vite.config.ts` — `@active-deck` alias from `LYSARK_DECK`, singlefile mode,
  KaTeX woff2-only, deck-named HTML rename.

## Commands

- `npm run dev` — dev server · `npm test` — vitest (**84**) · `npx tsc --noEmit`
- `npm run build` — classroom `dist/` · `npm run build:offline` →
  `dist-offline/<deck>-offline.html` · `npm run verify:offline` — Playwright
  file:// acceptance (0 fetch / 0 errors / KaTeX fonts intact)
- `npm run export:pdf` → `pdf-export/<deck>.pdf` (needs `build:offline` first)
- **Deck selection** — all default to `demo`. For the lecture, set the env var
  first: PowerShell `$env:LYSARK_DECK='baneplanlegging'; npm run build:offline`
  (output/verify/pdf paths all derive from it).

## Gotchas worth remembering

- **Preview tab rAF pause**: the Claude preview tab is backgrounded → `rAF` paused,
  render loop looks frozen, `preview_screenshot` times out. NOT a bug. Verify via
  **Playwright against `dist-offline`** (rAF runs there) — this is how every visual
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
  `fetch(` left in the bundle (three/urdf-loader) are dead code — `verify:offline`
  proves 0 requests fire. The raw 37 MB `assets/kuka_agilus/` is gitignored; only
  `src/assets/agilus/` (~2.9 MB) ships.

## Suggested next steps

- Push the branch / open a PR if desired.
- More lecture polish or more lectures under the seam (each a new `content/<deck>/`).
- [docs/ideas.md](ideas.md): `onEnter`/`onLeave` hooks, static-data plots on
  scene-less slides, an overlay-only ticker; mesh polish (lighten the black KUKA
  base against the dark ground); GLB conversion to shrink the offline file.
