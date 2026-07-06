# Lysark — handover

Snapshot for resuming after a context clear. The authoritative spec is
[docs/lysark-design.md](lysark-design.md); working style is in the repo-root
[CLAUDE.md](../CLAUDE.md); the candidate backlog is [docs/ideas.md](ideas.md).

## Where the project is

All seven milestones are complete, plus a theme pass and a real mesh robot.
Everything is committed and pushed to `origin/main`.

- **M1** skeleton + one scene · **M2** motion (PID torque joints, spring-damper
  camera, settle detection) · **M3** markdown+frontmatter slide engine · **M4**
  scene lifecycle (multi-scene, suspend/restore, snapshot crossfade, scene-less)
  · **M5** anchored overlays + uPlot plots + declarative idle · **M6** three
  build targets (classroom, single-file offline, Playwright PDF) · **M7** polish
  (presenter overview + shortcuts + help, tuning export, offline size pass).
- **Theme**: red/green/cheese dark palette as CSS design tokens.
- **Agilus**: a real KUKA KR 6 R900-2 URDF with Collada meshes, running from the
  single offline file with no fetch.

Each milestone ended with an adversarial multi-agent review (see `git log` for
"…adversarial review"); M7's caught a critical bug (a font-stripping regex that
merged all KaTeX @font-face rules → broken math). Worth continuing that pattern
for substantial changes.

## The deck — 11 slides, 3 scenes ([src/content/slides.md](../src/content/slides.md))

1 title (arm, idle wave) · 2 pid-control (arm) · 3 control-loop (arm, SVG
diagram) · 4 overshoot (arm, slider + error plot) · 5 end-effector (arm,
anchored `$x_e$` label) · 6 damping-regimes (arm) · 7 pendulum-cut (pendulum) ·
8 pendulum-swing (pendulum, slider + plot) · 9 agilus-intro (agilus mesh, idle
sweep) · 10 agilus-joint (agilus, slider + plot + anchored label) · 11 outro
(scene-less).

## Layout

- `src/engine/` — motion-system (PID + spring-damper channels), slide-engine,
  scene-manager (the M4 lifecycle), compile-slides (build-time markdown→objects),
  channel-binding, camera-merge.
- `src/scene/` — scene-layer (the one persistent WebGLRenderer), camera-controller.
- `src/scenes/` — `arm` (primitive URDF), `pendulum` (procedural), `agilus`
  (KUKA Collada mesh). One scene's GPU resources alive at a time.
- `src/overlay/` — overlay (screen-mode + live widgets), anchor-layer (per-frame
  projection), presenter (overview/help/indicator), widgets/ (slider, plot),
  project (pure projection helper).
- `src/styles.css` — theme tokens in `:root`. `src/content/deck.ts` — manifest.
- `scripts/` — check-offline.mjs (file:// acceptance), export-pdf.mjs.
- `vite.config.ts` — singlefile mode, KaTeX woff2-only plugin, HTML rename.

## Commands

- `npm run dev` — dev server · `npm test` — vitest (47) · `npx tsc --noEmit` — typecheck
- `npm run build` — classroom `dist/` · `npm run build:offline` →
  `dist-offline/lysark-offline.html` (~3.9 MB) · `npm run verify:offline` —
  Playwright file:// acceptance (0 fetch / 0 errors / KaTeX fonts intact)
- `npm run export:pdf` → `pdf-export/lysark.pdf` (needs `build:offline` first)

## Gotchas worth remembering

- **Preview tab rAF pause**: the Claude preview tab is backgrounded, so
  `requestAnimationFrame` is paused — the render loop looks frozen and
  `preview_screenshot` times out. NOT a bug. Verify via **Playwright against
  `dist-offline`** (rAF runs there), or pump frames manually through
  `window.__lysark` (exposes engine, motion, sceneManager, cameraCtl, overlay,
  anchorLayer, presenter, stepIdle, …). Memory: `preview-raf-paused`.
- **Mesh pipeline (Collada)**: a `.dae` is XML text → `import …?raw` +
  `ColladaLoader.parse` inside a custom `URDFLoader.loadMeshCb`. No base64
  encoder needed. Two traps: (1) `loadMeshCb`'s real signature is
  `(path, manager, material, onComplete)` — the shipped typings drop `material`,
  so a 3-arg override binds `onComplete` to the material and crashes silently;
  (2) hand the DAE back exactly as `ColladaLoader` returns it (like urdf-loader's
  default) — do NOT counter-rotate, or links separate at extended poses. Faceting
  is fixed with `toCreasedNormals(geometry, 40°)`, not a three.js limit.
- **Assets**: the raw 37 MB `assets/kuka_agilus/` ROS package is gitignored; only
  the one committed variant (`src/assets/agilus/`, kr6_r900_2, ~2.9 MB) is used.
- **file:// build**: no runtime fetch / dynamic import / workers-from-URL. The
  three `fetch(` left in the bundle (three.js/urdf-loader) are dead code —
  `verify:offline` proves 0 requests fire.

## Open threads (all in [docs/ideas.md](ideas.md))

- **Curve / trajectory widget** — path-planning polynomials: draw p(s) from
  coefficients, sliders driving constants, a looping marker dot. The most-wanted.
- Static-data plots on scene-less slides; `onEnter`/`onLeave` hooks; an
  overlay-only ticker so animated overlays run on scene-less slides.
- Mesh extensions: lighten the (accurate) black KUKA base against the dark
  ground, other Agilus variants, GLB conversion to shrink the offline file.
- Theme: every color is a token in `styles.css :root` — trivial to re-tune.

## Suggested next step

Author a real lecture as the dogfood (the spec's closing step), or build the
curve/trajectory widget. Both are green-field and well-scoped.
