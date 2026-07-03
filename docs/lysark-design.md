# Lysark — Design Document

The authoritative spec. It consolidates the original research report and the design addendum; where
they conflicted, the addendum's decisions won (see §12 for the resolved conflicts). The originals are
archived in `docs/archive/` — the research report keeps the full evidence, citations, and framework
comparison behind the decisions recorded in §2. Working instructions for Claude Code live in the
repo-root `CLAUDE.md`.

## 1. What Lysark is

Lysark is a framework for interactive robotics lecture slides. A deck mixes ordinary DOM slides
(text, KaTeX math, images, video, live plots) with declarative 3D scenes (three.js): URDF robots,
choreographed cameras, sliders that drive joints. Motion is pedagogical content, not decoration —
joints are driven by a real PID loop and the camera by a spring-damper, with the gains (Kp/Ki/Kd,
ω, ζ) exposed per widget, so the presentation physically demonstrates the control theory being
taught.

One codebase, three delivery targets:

| Target | Form | Constraints |
|---|---|---|
| Classroom | static `dist/` folder + portable static-server binary, or the single-file build | no installer, no admin rights |
| Student offline | one self-contained HTML file | fully interactive, must work double-clicked from `file://` |
| PDF | Playwright drives the built app, screenshots each slide at settled state | static by design |

The student-offline target is the deciding constraint. A `file://`-opened page blocks `fetch()`/XHR
and cross-origin module scripts, which kills every framework SPA build (Vite emits
`<script type="module" src="…">` plus runtime asset fetches — blank page with a CORS console error
under `file://`; confirmed Vite behavior, vitejs/vite #13201). It constrains every asset and code
decision from day one; see §9.

## 2. Decision record

Full evidence and the framework comparison table are in `docs/archive/lysark-design-document.md`.

- **Custom app, not reveal.js/Slidev.** The two hardest requirements — lifecycle-managed WebGL
  scenes and a true single-file `file://` build — both fight the slide frameworks and are native to
  a custom app. The frameworks would only contribute markdown authoring and PDF export, both
  replicable by a thin custom layer. The slide engine itself is small (~300 lines).
- **Rejected:** Slidev (SPA build fails `file://`), reveal.js (single-file is a long-standing
  unsolved request), Marp (no WebGL story), Spectacle/MDX Deck (React SPA, same `file://` problem),
  Motion Canvas (pre-rendered video, not live), Impress.js (no 3D model layer), native/threepp (no
  delivery target is better served by native).
- **Flip conditions.** If the student-offline file need not be interactive (video/PDF suffices),
  Slidev with a `global-bottom.vue` three.js layer becomes preferable for authoring speed. If
  cross-slide scene persistence is never needed, reveal.js with per-slide canvases is lower effort.
  Only the combination of persistent scenes + interactive single file forces the custom build.
  Going native (threepp/C++) would only be justified if the deck evolved into a heavy real-time
  physics sim needing native performance — not the case here.
- **Stack:** Vite + TypeScript + three.js. `urdf-loader` (gkjohnson) for robots. KaTeX for math
  (synchronous, self-contained, ~348 KB with fonts); switch to MathJax only if a lesson needs
  LaTeX features KaTeX lacks. uPlot for live plots (~48 KB; Plotly rejected at 3.6 MB). No
  React/Vue — the overlay layer is simple enough that a reactive framework buys little and
  complicates per-frame anchor projection. No spring/animation library — the ~40-line integrators
  *are* course content (§5). Rapier excluded unless a lesson needs contact dynamics; if ever
  added, use `@dimforge/rapier3d-compat` (base64-embedded WASM) in *all* targets — one Rapier
  build everywhere, no `vite-plugin-wasm`/`vite-plugin-top-level-await` needed. (Supersedes the
  report's classroom-only non-compat option.)
- **Authoring:** markdown + YAML frontmatter compiled to slide objects (§8). Scenes are TypeScript
  modules referenced by id (§7).
- **Versions** as researched 2026-07: `three` 0.185.0, `urdf-loader` 0.13.0, `katex` ^0.16,
  `uplot` ^1.6.24, `vite` ^7, `vite-plugin-singlefile` ^2, `playwright-chromium` (dev). Re-check
  and pin exact versions at implementation time; vendor `urdf-loader` if long-term reproducibility
  matters.

## 3. Deck model

- A deck is an ordered list of slides. A slide either belongs to exactly one **scene** or is
  **scene-less**. Multiple scenes per deck is the normal case.
- A scene spans a **contiguous range** of slides (e.g. slides 4–11). Authoring expresses this with
  a per-slide `scene:` key; the compiler infers ranges from contiguous runs and errors on
  non-contiguous use of the same scene id. (Deviation from the addendum's literal "scene declares
  a slide range": per-slide keys survive slide insertion without renumbering; the semantics are
  identical.)
- **Scene-less slides are first-class**, not empty scenes: the canvas is hidden and the WebGL
  render loop is fully stopped — zero GPU work. Only the overlay layer renders (text, KaTeX,
  video, plots). Plots on scene-less slides show static data — live `bind:` plots require a scene
  (§8). DOM animation may still run there via the overlay ticker (§5).

## 4. Runtime architecture

```
┌────────────────────────────────────────────────────┐
│ App shell (index.html)                             │
│  ┌───────────────────────────────────────────────┐ │
│  │ SceneLayer: one WebGLRenderer + canvas,       │ │ ← renderer lives the whole session;
│  │ hosting AT MOST ONE active scene's graph      │ │   scene graphs come and go (§4.1)
│  └───────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────┐ │
│  │ OverlayLayer (DOM): bullets, KaTeX, images,   │ │ ← swapped per slide; screen-space
│  │ video, sliders, uPlot plots, anchored labels  │ │   or 3D-anchored (§4.2)
│  └───────────────────────────────────────────────┘ │
│  Controllers: CameraController (spring-damper),    │
│  JointController (PID), MotionSystem (fixed dt)    │
│  SlideEngine: index, next/prev, applies slide      │
│  target state → controllers + overlay              │
└────────────────────────────────────────────────────┘
```

- **One `WebGLRenderer` and one canvas element** are created at startup and kept for the whole
  session — WebGL context creation is expensive and browsers cap live contexts. What is created
  and destroyed per scene is the scene graph and its GPU resources, never the renderer.
- **Single render loop**: fixed-timestep accumulator → `MotionSystem.step(dt)` → `renderer.render()`.
  The loop runs only while a scene is active or a canvas fade is in progress; on scene-less slides
  it is stopped. `MotionSystem` is decoupled from rendering: when the WebGL loop is stopped, a
  lightweight overlay ticker (its own rAF) steps only the overlay channels — widget springs,
  static-plot transitions — and self-suspends the moment everything is settled, so an idle
  scene-less slide does zero rAF work.
- **Text is never rendered inside the WebGL scene.** The "text lives in the world" illusion comes
  from choreographing camera settle + anchored-element fade-in.

### 4.1 Scene lifecycle

- **Within a scene's range:** persistent scene behavior. Camera and robot state carry across
  slides; each slide declares a target state and the controllers animate toward it (§5). Nothing
  reloads, nothing snaps.
- **Across a scene boundary:** no camera continuity, no clever 3D transitions between unrelated
  scenes. The transition is a cut or a crossfade, optionally through an overlay-only slide.
  Crossfade without double GPU residency: render the outgoing scene one last frame, capture the
  canvas to a data URL (capture immediately after `render()` in the same frame — no
  `preserveDrawingBuffer` needed), show it as a DOM `<img>` over the canvas, dispose the old scene,
  build the new one, fade the snapshot out.
- **Suspend (leaving a scene):** serialize dynamic state — joint positions and velocities, widget
  values — to a plain object; free all GPU resources; detach the graph from the renderer. Never
  keep two scenes' GPU resources alive simultaneously (`renderer.info` asserts this in tests).
  (M4 deviation from the original "camera pose" item: camera pose is deliberately *not*
  serialized — boundary re-entry resolves the destination slide's camera spec against the scene's
  default framing instead, which is deterministic where restoring a presenter-orbited pose would
  not be. Scene defaults must therefore declare a full `lookAt` + `offset` framing.)
- **Restore (re-entering, including backward navigation):** reattach, initialize motion channels
  from the serialized state, and let the controllers drive toward the entering slide's *effective*
  targets (§4.3) — re-entry settles naturally even when entering from a different slide than we
  left.
- **Implementation shortcut, v1:** retain the CPU-side scene graph on suspend and dispose only GPU
  resources (`geometry.dispose()`, `material.dispose()`, `texture.dispose()` free GPU buffers;
  the JS-side typed arrays and image sources remain and three.js re-uploads lazily on next
  render). This makes restore near-instant and avoids re-parsing models. The serialize/restore
  contract (§7) still exists so a scene *can* be fully destroyed and rebuilt if a deck ever holds
  too many scenes for CPU memory — but that is not the v1 path. Complies with the addendum's
  "destroy GPU resources" requirement; improves on its "rebuild on re-entry" latency.
- **Scene → scene-less:** fade the canvas out, then stop the loop and hide the canvas. Never yank
  it. Re-entering a scene uses the same restore mechanism as scene-to-scene boundaries.

### 4.2 Overlay system

Two positioning modes per overlay element:

- `screen:` — fixed screen-space layout. Bullets, headings, equations. Transitions are DOM
  fades/slides. **Default mode.**
- `anchor: <node>` — the element is still DOM (crisp text, KaTeX works), but its position is
  computed per frame by projecting a named 3D node (e.g. `robot.link6`) to screen space, plus an
  optional screen-space pixel offset. CSS2DRenderer-style; implemented in the overlay layer, not
  with WebGL text. Occlusion hiding via raycast is optional and off by default.

### 4.3 State model

- Each scene owns a mutable state store. **Slides declare targets; controllers mutate actual state
  toward targets.** Slides never mutate the scene graph directly.
- **Effective targets are cumulative.** Frontmatter targets are sparse (a slide lists only what it
  changes), so the compiler resolves each slide's *effective* full target state: slide 1 of a
  scene's range starts from the scene module's declared defaults; every subsequent slide inherits
  the previous slide's effective targets and overrides only its declared keys. Navigation —
  forward, backward, or entering mid-range via restore — always drives toward the destination
  slide's effective state. This is what makes motion reversible: backward navigation re-applies
  the previous slide's effective targets, which include every channel any earlier slide set.
- Fragments (step-wise bullet reveals) are overlay-only in v1, authored with an explicit
  `<!-- pause -->` marker line in the slide body (§8); scene targets are per-slide, not
  per-fragment. Next/prev advances through fragments before slides, and in reverse when going
  backward.

## 5. Motion system

A single `MotionSystem` owns a list of controlled scalar channels, stepped at a fixed timestep
with an accumulator.

```js
// Critically-damped second-order channel (camera, UI micro-interactions)
class SpringDamper {
  constructor({omega = 8, zeta = 1}) { this.omega = omega; this.zeta = zeta; }
  step(x, target, v, dt) {
    const a = this.omega*this.omega*(target - x) - 2*this.zeta*this.omega*v;
    v += a*dt; x += v*dt; return [x, v];
  }
}

// PID channel (robot joints — deliberately shows overshoot/settle)
class PID {
  constructor({kp, ki, kd, outMin, outMax}) { Object.assign(this, {kp,ki,kd,outMin,outMax}); this.i = 0; this.ePrev = 0; }
  step(measured, setpoint, dt) {
    const e = setpoint - measured;
    this.i += e*dt;
    const d = (e - this.ePrev)/dt; this.ePrev = e;
    return clamp(this.kp*e + this.ki*this.i + this.kd*d, this.outMin, this.outMax);
  }
}
```

- **Joints:** PID output is a **torque on a unit-inertia joint** — ẍ = τ, integrated twice into
  `robot.setJointValue(name, angle)`, with hard stops at the URDF limits. (Resolved during M2: an
  earlier draft said the output drives joint *velocity*, but velocity-mode P control is a
  first-order lag that cannot overshoot, and Kd would *increase* overshoot in that form. The
  torque form matches the taught equation τ = Kp·e + Ki·∫e + Kd·ė and gives ζ ≈ Kd/(2·√Kp), so
  small Kd visibly overshoots — the behavior the lesson needs.) Tunable Kp/Ki/Kd per joint; a
  slider sets the setpoint and the joint visibly overshoots and settles — the course's PID lesson
  made physical.
- **Camera:** spring-damper on position and look-at target; ζ exposed to demo under-/critically-/
  over-damped camera moves. Two constraints found during M2 review: (1) large moves with ζ below
  ~0.4 can swing the look point past the camera mid-flight (the view whips); the runtime enforces
  a minimum camera-to-look distance and the demo floors ζ at 0.4 — deck choreography that needs
  deeper underdamping must spring in look-relative coordinates instead. (2) Gains satisfying
  Ki ≥ Kd·Kp make the joint loop closed-loop unstable (Routh–Hurwitz on s³ + Kd·s² + Kp·s + Ki) —
  deliberately reachable as a teaching moment, surfaced in the UI rather than prevented, and one
  more reason the PDF exporter's per-slide settle wait needs its hard timeout (§9c).
- **UI micro-interactions:** the same spring-damper on knobs and panel slides for physical feel.
- All parameters live in per-widget config so the lecturer can tune feel per slide.
- **Settle detection:** the system is settled when every active channel has |x − target| < ε and
  |v| < ε_v for N consecutive frames. Used by the PDF exporter (§9c) and by anchored-overlay
  fade-in choreography.

## 6. Navigation

- Keyboard: arrows and space; also PageUp/PageDown so presenter clickers work in the classroom.
- Backward navigation is fully supported, both within scenes (§4.3) and across boundaries (§4.1).
- Slide index in the URL hash for deep links (works under `file://`).

## 7. Scene modules

Each scene is a TypeScript module, statically imported (the single-file build forbids dynamic
`import()`), registered by id in the deck manifest:

```ts
// src/content/deck.ts
import arm from '../scenes/arm'
import gripper from '../scenes/gripper'
import slides from './slides.md'   // compiled to slide objects at build time (§8)
export default defineDeck({ scenes: { arm, gripper }, slides })
```

```ts
interface SceneModule {
  id: string
  build(ctx: SceneContext): Promise<SceneInstance>   // construct graph, load robot via parse() (§9b)
  defaults: SlideTargets                             // effective targets for slide 1 of the range (§4.3)
  hooks?: Record<string, (ctx: SceneContext) => void> // referenced by name from frontmatter (§8)
}
interface SceneInstance {
  root: THREE.Object3D
  anchors: Record<string, THREE.Object3D>   // named nodes for camera lookAt / overlay anchor:
  channels: Record<string, Channel>         // controllable scalars: joints, widget-bound values
  serialize(): SceneState                   // joint pos/vel, camera pose, widget values
  restore(state: SceneState): void
  dispose(): void                           // free GPU resources (and CPU graph if fully destroying)
}
```

Channels expose `measured`, `setpoint`, and derived values (e.g. `error`) so plots can bind to any
of them (§8).

## 8. Content authoring model

Slides are authored in Markdown with YAML frontmatter, `---`-separated. A small Vite plugin
compiles `slides.md` into slide objects **at build time** (the `import slides from './slides.md'`
in §7 goes through this transform): frontmatter is parsed, effective targets resolved (§4.3),
markdown rendered to HTML, and KaTeX pre-rendered. The markdown/YAML/KaTeX machinery stays out of
the runtime bundle — which matters for the single-file size budget — and the dev server gets HMR
on slide edits for free. Example:

```markdown
---
scene: arm                   # membership; contiguous runs form the scene's range (§3)
id: end-effector-zoom
camera:
  lookAt: robot.link6        # named anchor node from the scene module
  distance: 0.6
  spring: { omega: 6, zeta: 1.0 }
joints:                      # setpoints; PID animates toward them
  joint1: 0.0
  joint2: -0.6
widgets:
  - type: slider
    bind: joint3
    range: [-1.57, 1.57]
    pid: { kp: 12, ki: 0.0, kd: 2.5 }
  - type: plot
    lib: uplot
    bind: joint3.error       # live-updating tracking error
anchored:                    # anchor-mode overlay elements (§4.2)
  - anchor: robot.link6
    offset: [24, -12]
    content: "$x_e$"
---
## Reaching the target
- The end effector converges under PID control
- Watch the overshoot when $K_d$ is small
$$\tau = K_p e + K_i \int e\,dt + K_d \dot e$$
```

- Scene-less slides simply omit the `scene:` key; only overlay content applies. `bind:` requires a
  scene — on scene-less slides, plots carry static data (declared in frontmatter or an asset), not
  live channel bindings.
- The markdown body is screen-mode overlay content; anchored elements are declared in frontmatter.
- Fragments: a `<!-- pause -->` line in the body splits it into reveal steps (§4.3).
- Equations: `$…$`/`$$…$$` pre-rendered by KaTeX in the compile step.
- Media: standard markdown image/video; inlined as base64 in the single-file build.
- `bind:` wires a widget to a scene channel so sliders and plots are declarative.
- `onEnter: <name>` / `onLeave: <name>` per slide for anything declarative syntax can't express —
  the name is resolved against the owning scene module's exported `hooks` map (§7); scene-less
  slides resolve against a deck-level `hooks` map in the manifest. YAML carries only names, never
  code.
- The frontmatter schema is the one piece of design to get right early; keep it versioned.

## 9. Build pipeline — three targets

One codebase, three `vite build` modes selected by env flag. `base: './'` in `vite.config.ts` for
all builds.

**a) Classroom (no admin rights):** `vite build` → static `dist/`. Two run options: the folder
served by a bundled portable static-server binary (no install, no admin), or the single-file build
opened directly. Full resolution, all interactivity.

**b) Student offline (one file):** `vite build --mode singlefile` with `vite-plugin-singlefile`
(`useRecommendedBuildConfig: true`, `removeViteModuleLoader: true`). Hard constraints:

- **No `fetch` anywhere at runtime.** All GLB/URDF/textures pre-encoded to base64 constants
  (`scripts/encode-assets.mjs`); robot loaded via `URDFLoader.parse(urdfString)` plus a
  `loadMeshCb(path, manager, onComplete)` override that runs
  `GLTFLoader.parse(arrayBuffer, '', onLoad, onError)` on embedded ArrayBuffers, so `package://`
  mesh references resolve from memory. The default `urdf-loader` `load()` path uses `fetch` and
  WILL fail under `file://` — only `parse()` + custom `loadMeshCb` avoids it. Textures via `data:`
  URIs (three.js's ImageLoader special-cases `data:` URLs — same-origin, never fetched) or embedded
  inside the GLB.
- **No dynamic `import()` / code-splitting** — breaks under `file://`. Everything statically
  imported so the plugin inlines it. No workers-from-URL, no CDN-loaded anything.
- **Size budget:** base64 adds ~33% over raw bytes with no gzip/Brotli relief under `file://`.
  Target well under ~50 MB on disk: down-res textures, Draco-compressed GLB decoded in-memory,
  optionally in-JS decompression (fflate / `DecompressionStream`) for the largest blobs. Prefer
  short low-bitrate video or replace video with animated 3D.
- Output: `lysark-offline.html`, double-click to open on Win/Mac/Linux. Acceptance: zero console
  errors on a clean machine with no server.

**c) Static PDF:** a Playwright (chromium) script launches the built app, steps through each
slide, waits for settle (§5) with a fixed generous per-slide wait as fallback, screenshots canvas +
overlay at full resolution, composites one page per slide. `node scripts/export-pdf.mjs`. All
interactivity is lost by design.

## 10. Project structure

```
/src
  /engine        slide-engine.ts, motion-system.ts, pid.ts, spring-damper.ts, scene-lifecycle.ts
  /scene         scene-layer.ts, camera-controller.ts, robot.ts (urdf), channels.ts
  /scenes        one module per scene (arm.ts, gripper.ts, …)
  /overlay       overlay.ts, anchor-projection.ts, katex-render.ts, widgets/ (slider, toggle, plot, video)
  /content       deck.ts (manifest), slides.md (+ assets)
  /assets        models (glb/urdf), textures, video   (base64-inlined in singlefile mode)
/scripts         export-pdf.mjs (playwright), encode-assets.mjs (base64)
vite.config.ts   (base:'./', singlefile mode, slides.md compile plugin; no wasm plugins —
                  rapier3d-compat embeds its WASM if Rapier is ever added)
```

## 11. Milestones

1. **M1 — Skeleton + one scene.** Vite app, renderer + canvas, render loop, orbit debug camera,
   one URDF robot via `urdf-loader`, one slider → `setJointValue`. Go/no-go: if this isn't working
   within a day, the problem is model assets, not architecture.
2. **M2 — Motion system.** `PID`, `SpringDamper`, `MotionSystem` (fixed dt, decoupled from the
   render loop — see §4), settle detection. Sliders set setpoints; joints overshoot and settle.
   Camera controller with ζ demo. **M1+M2 are the evaluation gate:** the persistent scene + PID
   motion is the bulk of the project's value — if it doesn't feel right here, rethink before
   building the slide engine on top.
3. **M3 — Slide engine + authoring.** Markdown+frontmatter compiler → slide objects; next/prev
   including backward; slides push camera/joint/widget targets; overlay screen mode with fragments
   and fades.
4. **M4 — Scene lifecycle.** Multiple scenes, suspend/serialize/restore, boundary
   snapshot-crossfades, scene-less slides with stopped loop and hidden canvas. Verify with a
   3-scene test deck: forward and backward navigation across every boundary, repeated re-entry,
   `renderer.info` confirms GPU resources are freed.
5. **M5 — Anchored overlays + rich content.** Per-frame anchor projection, settle + fade-in
   choreography, KaTeX, images/video, uPlot plots bound to channels. Reference example: idle
   animation on slide 1, zoom-to-end-effector with anchored label on slide 2.
6. **M6 — Build targets.** (a) classroom static build + portable server; (b) single-file build:
   asset encoder, `parse()`-only loaders, clean-machine `file://` acceptance test; (c) Playwright
   PDF exporter with settle detection.
7. **M7 — Polish.** Per-slide motion tuning, presenter niceties (slide list overview, keyboard
   shortcuts), size-optimization pass on the offline file.

Author content in markdown from day one (M3 onward) so authoring ergonomics get exercised early;
validate the offline target at M6, not later — it constrains every asset decision. Finish by
authoring one real lecture as the dogfood.

## 12. Conflicts resolved in this consolidation

The research report predated the addendum; the addendum won every conflict:

- Report: "one three.js canvas lives for the whole session… the scene never unmounts" → replaced
  by the multi-scene lifecycle of §4.1. The *renderer* persists; scenes do not.
- Report's architecture diagram placed "plots-as-textures" inside the WebGL scene → dropped; plots
  are DOM overlay widgets (uPlot renders to its own 2D canvas in the overlay layer), consistent
  with "text never in WebGL".
- Report's milestones had no scene lifecycle, scene-less slides, or anchored overlays → M4/M5
  added.
- Addendum's "scene declares a slide range" → expressed as per-slide `scene:` keys with inferred
  contiguous ranges (§3); same semantics, insertion-safe authoring.
- Addendum's "rebuild on re-entry" → v1 retains the CPU graph and disposes GPU only (§4.1);
  strictly better latency, same GPU guarantee.

## 13. Risks

- **Single-file size** is the main risk: base64 +33%, no compression relief under `file://`.
  Budget assets deliberately from M1 (every model added is a future offline-build cost).
- **`file://` is unforgiving:** any stray `fetch`, dynamic `import()`, worker-from-URL, or
  CDN-loaded module silently breaks the offline build. Enforce by convention; test by
  double-clicking on a clean machine.
- **Suspend/restore is the riskiest custom logic.** Leaks or state drift on repeated
  scene re-entry will be subtle; M4's navigation-loop test with `renderer.info` assertions is the
  guard.
- **PDF settle detection** must be reliable or slides screenshot mid-motion; the fixed generous
  per-slide wait is the safe fallback.
- **three.js moves fast** (~monthly releases); pin a version, budget occasional migration. Vendor
  `urdf-loader` if long-term reproducibility matters.
- **A custom engine is code owned forever.** It's small (~300 lines of engine) with no plugin
  ecosystem — an accepted trade given the unusual requirements.
