# Design Document: Interactive Robotics Teaching Slide Deck System

## TL;DR
- **Build a minimal custom app (Vite + three.js + a ~300-line slide engine), not a retrofit of reveal.js or Slidev.** The two hardest requirements — one persistent WebGL scene across slides, and a true single-file offline build that runs from `file://` — both fight the slide frameworks and are native to a custom app.
- **The persistent 3D scene is the architectural spine:** one three.js canvas lives for the whole session; each slide is a declarative overlay that pushes a target scene/camera/widget state, and a custom PID/spring-damper controller drives everything (joints, camera, UI) so the presentation literally demonstrates the control theory being taught.
- **Three targets from one codebase via build flags:** classroom (full, portable static folder or single file, no admin), student offline (one self-contained HTML via vite-plugin-singlefile with all models embedded as base64 and loaded through `GLTFLoader.parse`), and PDF (Playwright screenshots each slide's settled scene state into a static deck).

## Key Findings

### The deciding constraint is the single-file offline target
A `file://`-opened HTML page blocks `fetch()`/XHR and cross-origin module scripts. A Slidev or Vite SPA build emits `<script type="module" src="./assets/…">` plus code-split chunks and runtime `fetch` of assets — opening `dist/index.html` directly yields a blank page with the exact console error `Access to script … from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: http, data, isolated-app, chrome-extension, chrome, https, chrome-untrusted` (confirmed as a reproducible Vite build behavior in vitejs/vite issue #13201 and Vite's own troubleshooting docs, which state "You will need to access the file with http protocol"). Slidev's `slidev build` produces a multi-file SPA, not one file, and needs a local server. This kills both frameworks for the student-offline requirement unless you ship a web server, which violates "one downloadable file."

The custom-app path solves it cleanly: `vite-plugin-singlefile` inlines all JS/CSS into one HTML — its own docs describe the use case exactly ("apps bundled into a single HTML file that you can double-click and open directly in your web browser, no server needed") — and all 3D models are embedded as base64 and parsed in-memory. Per the three.js docs, `GLTFLoader.parse(data: string | ArrayBuffer, path, onLoad, onError)` "Parses the given glTF data and returns the resulting group" with no network fetch; the urdf-loader README shows `URDFLoader.parse(urdfContent)` plus a `loadMeshCb(path, manager, onComplete)` override so `package://` mesh references resolve from embedded ArrayBuffers instead of disk. Textures via `data:` URIs load without CORS because three.js's ImageLoader special-cases `data:` URLs (sets `image.src` directly, skipping `crossOrigin`), so a data-URI texture is same-origin and never fetched.

### The persistent 3D scene wants to escape the framework anyway
Both frameworks *can* host a persistent canvas — reveal.js via a background layer, Slidev via `global-bottom.vue` global layers (Slidev's docs: "Global layers allow you to have custom components that persist across slides… cross-slide animations, global effects"). There is a working proof of concept, `Leone25/slidev-threejs`, whose author describes it as "sli.dev + a bottom global layer with three.js on it." But in both cases the canvas lives *outside* the slide-content system and you hand-drive it with your own animation loop and state. You're already writing the hard 90% (scene, camera controller, motion system, model loading) yourself; the framework only contributes markdown authoring and PDF export — both of which a thin custom layer can replicate. (For context, the Codrops "persistent Three.js scene + Barba.js" pattern shows the canonical singleton-Experience approach: "The Three.js scene is created once on initial load and persists for the entire session… no re-initialization, no flickering, and no repeated network requests for models.")

### Motion system: write a small PID/spring integrator, don't pull in a spring library
The presentation's motion is pedagogical content, not decoration. A custom fixed-timestep integrator (PID for joints, critically-damped spring-damper for camera and UI) is ~40 lines, exposes exactly the parameters the course teaches (Kp, Ki, Kd; ω_n, ζ), and needs no React. react-spring is React-only ("cross-platform spring-physics first animation library" but built around React hooks/`animated` components); popmotion/motion springs are framework-agnostic and expose stiffness/damping/mass ("A spring animation based on stiffness, damping and mass… based on the same equations underlying Apple's CASpringAnimation") but hide the integrator you'd want to *show* students. Rapier.js (WASM rigid-body engine, `@dimforge/rapier3d`) is overkill unless you need true contact dynamics; keep it as an optional module.

### Supporting choices
- **3D:** three.js — r185 is current, published as npm `three` v0.185.0 (~2.7M weekly downloads); pin to a specific release. `urdf-loader` (gkjohnson, Apache-2.0, NASA-JPL origin — "Copyright © 2020 California Institute of Technology"); npm currently lists latest as **0.13.0** (pin whichever you test against). It exposes `robot.setJointValue(jointName, jointAngle)` (or `robot.joints[jointName].setJointValue(jointAngle)`), with meshes overridable via `loadMeshCb`.
- **Math:** KaTeX — its site states it "renders its math synchronously and doesn't need to reflow the page," is "self-contained… no dependencies and can easily be bundled with your website resources," and supports server-side pre-rendering. Roughly 348 KB with JS + fonts (commonly cited estimate; exact combined byte size varies by which fonts you ship). MathJax only if you need advanced LaTeX features MathJax 3 supports and KaTeX doesn't.
- **Plotting:** uPlot for slider-driven live graphs — v1.6.24 measures **47.9 KB** and renders in **34 ms** in the library's own benchmark table, "the smallest and fastest time series plotter that doesn't make use of context-limited WebGL shaders or WASM," and can live-stream at 60 fps. Avoid Plotly.js (**3,600 KB / 3.6 MB**, slowest to render at 310 ms in that same benchmark — ~75× uPlot's size) in a single-file build.

## Details

### Stack decision and rejected alternatives

| Option | Persistent WebGL across slides | Single-file offline (file://) | PDF export | Math | Authoring | Verdict |
|---|---|---|---|---|---|---|
| **Custom Vite + three.js + thin slide engine** | Native — canvas is the app | Native via vite-plugin-singlefile + `parse()` | Playwright screenshot script | KaTeX bundled | Markdown/MDX-lite you define | **Chosen** |
| reveal.js | Background layer / custom canvas overlay | Hacky; single-file HTML is a long-standing unsolved request (issue #788, discussion #3731), needs the SingleFile extension or pandoc `--self-contained` | Built-in `print-pdf` (Chrome) | Plugin (MathJax loaded remotely by default; must bundle manually for offline) | Markdown/HTML | Fallback if authoring simplicity dominates |
| Slidev | `global-bottom.vue` global layer (proven demo) | **Fails** — SPA build, ES modules + fetch break on file:// | `slidev export` via `playwright-chromium` (good quality; use `--per-slide` for global layers) | KaTeX built-in | Best-in-class markdown + Vue | Rejected on offline target |
| Marp/Marpit | No real WebGL story | Static HTML but not interactive 3D | Excellent PDF/PPTX | Yes | Cleanest markdown | Rejected — not interactive enough |
| Spectacle / MDX Deck | Via React components; heavy | React SPA, same file:// problems | Print | Yes | JSX | Rejected — React runtime, no offline win |
| Motion Canvas | Not built for live interactivity (open issue #213 requests keypress-driven live presentation) | Designed for rendered video, not live keypress decks | N/A | N/A | TS timelines | Rejected — pre-rendered animation tool |
| Impress.js | Spatial zoom, no 3D model layer | Static but no 3D | Weak | Plugin | HTML | Rejected |

Native (threepp / C++) is **not** recommended: none of the three delivery targets (portable no-admin browser run, one-file cross-platform download, browser-driven PDF) are better served by native, and web wins decisively on the "double-click to open" and cross-platform portability constraints. (Given the user's existing threepp relationship, the only scenario that would flip this is if the deck evolved into a heavy real-time physics sim needing native performance — not the case here.)

### Architecture

```
┌─────────────────────────────────────────────┐
│  App shell (index.html, one persistent canvas)│
│  ┌──────────────────────────────────────────┐ │
│  │ SceneLayer (three.js): robot(s), lights,  │ │  ← lives entire session
│  │ ground, plots-as-textures, gizmos         │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │ OverlayLayer (DOM/HTML): bullet points,   │ │  ← swapped per slide
│  │ KaTeX equations, images, video, sliders   │ │
│  └──────────────────────────────────────────┘ │
│  Controllers: CameraController (spring-damper),│
│  JointController (PID), MotionSystem (fixed dt)│
│  SlideEngine: index, next/prev, applies slide  │
│  target state → controllers + overlay          │
└─────────────────────────────────────────────┘
```

- **Single render loop** drives `MotionSystem.step(dt)` (fixed timestep with accumulator) then `renderer.render()`. The scene never unmounts.
- **Each slide is a declarative object**: `{ camera: {target, position, lookAt}, joints: {j1: 0.5, …}, widgets: [...], overlay: <html/md>, onEnter/onLeave hooks }`.
- **Slide transition** = the engine reads the next slide's targets and hands them to the controllers; the PID/spring controllers animate *toward* those targets over subsequent frames (this is what produces the smooth zoom-to-end-effector and the overshoot/settle on joints). Nothing snaps.
- **State continuity**: scene state is a single mutable store; slides mutate targets, not the scene graph directly. Going backward re-applies the previous slide's targets, so motion is reversible. (This mirrors reveal.js's own `getState()`/`setState()` snapshot idea, but you own it.)

### Motion system design

A single `MotionSystem` owns a list of controlled scalars, each with a controller:

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

- **Joints**: PID output drives joint velocity/torque integrated into `robot.setJointValue(name, angle)`. Tunable `Kp/Ki/Kd` per joint; a slider sets the setpoint and the joint visibly overshoots and settles — the course's PID lesson made physical.
- **Camera**: spring-damper on position and look-at target; `ζ` exposed so you can demo under-/critically-/over-damped camera moves.
- **UI micro-interactions**: same spring-damper on toggle knobs / panel slides for a physical feel.
- All parameters live in a per-widget config so the lecturer can tune feel per slide.

### Content authoring model

Author in Markdown with YAML frontmatter per slide (`---` separated), plus a `scene:` block of declarative directives. A build step compiles this to slide objects. Example:

```markdown
---
id: end-effector-zoom
camera:
  lookAt: robot.link6        # named scene target
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
---
## Reaching the target
- The end effector converges under PID control
- Watch the overshoot when $K_d$ is small
$$\tau = K_p e + K_i \int e\,dt + K_d \dot e$$
```

- Equations: `$…$`/`$$…$$` rendered by KaTeX at build/enter time.
- Media: standard markdown image/video; in the single-file build these are inlined as base64.
- `bind:` wires a widget to a scene channel so sliders/plots are declarative.

### Build pipeline for the three targets

One codebase, three `vite build` modes selected by env flag. Set `base: './'` in `vite.config.ts` for all builds so relative asset paths work.

**a) Classroom (no admin rights):** `vite build` → static `dist/` folder. Ship two run options: (1) the folder served by a bundled tiny static-server binary (portable `.exe`, no install, no admin), or (2) the single-file build below opened directly in the classroom browser. No installer, no admin rights required. Full resolution, all interactivity.

**b) Student offline (one file):** `vite build --mode singlefile` with `vite-plugin-singlefile` (`useRecommendedBuildConfig: true`, `removeViteModuleLoader: true` to strip Vite's bundle-loading function). Hard constraints:
- **No `fetch` anywhere at runtime.** All GLB/URDF/textures pre-encoded to base64 constants; robot loaded via `URDFLoader.parse(urdfString)` + `loadMeshCb` that runs `GLTFLoader.parse(arrayBuffer, '', onLoad, onError)` on embedded ArrayBuffers; textures via `data:` URIs or embedded inside the GLB. (The default urdf-loader `load()` path uses `fetch` with `{ mode: 'cors', credentials: 'same-origin' }` and WILL fail under file:// — only `parse()` + custom `loadMeshCb` avoids this.)
- **No dynamic `import()`/code-split** (breaks under file://). Keep everything static so the plugin inlines it. If you include Rapier, use `@dimforge/rapier3d-compat`, which "embed[s] the WASM file (encoded in base64) into the main JS file" — the only Rapier build that survives single-file/file://.
- **Size budget:** base64 adds a fixed ~33% over raw bytes (4 output chars per 3 input bytes) with **no server gzip/Brotli relief under file://** — the on-disk HTML carries the full inflation. Keep total models+video modest (target well under ~50 MB); down-res textures, use Draco-compressed GLB decoded in-memory, and consider in-JS gzip (fflate/`DecompressionStream`) for the largest blobs. Video: prefer short, low-bitrate clips or replace with animated 3D.
- Output: `robotics-slides-offline.html`, double-click to open on Win/Mac/Linux.

**c) Static PDF:** a Playwright (chromium) script launches the built app, steps through each slide, waits for the scene to *settle* (motion system reports rest, or a fixed `--wait`), screenshots the canvas + overlay at full res, and composites one page per slide into a PDF. This substitutes real static renders of the 3D scenes (no live WebGL in the PDF). Command: `node scripts/export-pdf.mjs`. This mirrors how Slidev/decktape drive Playwright but is tailored to trigger our per-slide settled state before capture.

### Project structure and key dependencies

```
/src
  /engine        slide-engine.ts, motion-system.ts, pid.ts, spring-damper.ts
  /scene         scene.ts, camera-controller.ts, robot.ts (urdf), plots.ts (uplot)
  /overlay       overlay.ts, katex-render.ts, widgets/ (slider, toggle, plot, video)
  /content       slides.md (+ assets), compiled to slide objects
  /assets        models (glb/urdf), textures, video  (inlined in singlefile mode)
/scripts         export-pdf.mjs (playwright), encode-assets.mjs (base64)
vite.config.ts   (base:'./', singlefile mode, wasm plugins if Rapier)
```

Key deps (pin exact versions you test against): `three` (v0.185.0 current; pin it), `urdf-loader` (npm latest 0.13.0), `katex` (^0.16), `uplot` (^1.6.24), `vite` (^7), `vite-plugin-singlefile` (^2), `playwright-chromium` (dev), optional `@dimforge/rapier3d-compat` (base64-embedded WASM), optional `fflate` for in-JS decompression. If using the non-compat Rapier build in the classroom target, add `vite-plugin-wasm` + `vite-plugin-top-level-await`.

### Phased implementation plan (milestones for Claude Code)

1. **M1 – Skeleton + persistent scene.** Vite app, one three.js canvas, render loop, orbit debug camera, load one URDF robot via `urdf-loader`, one slider → `setJointValue`. Confirm it runs.
2. **M2 – Motion system.** Implement `PID`, `SpringDamper`, `MotionSystem` (fixed dt). Sliders set setpoints; joints overshoot/settle. Camera controller with ζ demo.
3. **M3 – Slide engine + authoring.** Markdown+frontmatter compiler → slide objects; next/prev; each slide pushes camera/joint/widget targets; smooth transitions. Overlay layer with bullet fragments.
4. **M4 – Rich content.** KaTeX equations, images/video, uPlot live plots bound to channels, idle animation on slide 1 + zoom-to-end-effector on slide 2 (the reference example).
5. **M5 – Build targets.** (a) static classroom build + portable static-server option; (b) single-file build: asset base64 encoder, switch all loaders to `parse()`, verify `file://` works with zero console errors on a clean machine; (c) Playwright PDF exporter with settle-detection.
6. **M6 – Polish.** Per-slide motion tuning, presenter niceties (slide list, keyboard nav), size-optimization pass on the offline file.

## Recommendations
- **Start now with the custom Vite + three.js app.** Do M1–M2 first; if the persistent scene + PID motion feels right (it will be the bulk of the value), continue. Concrete go/no-go: if M1 (URDF loads, slider moves a joint) isn't working within a day, that's a red flag on model assets, not the architecture.
- **Author content in markdown from day one** so you don't lose Slidev-style ergonomics. The frontmatter `scene:` schema is the one piece of design to get right early.
- **Validate the offline-file target at M5, not later** — it constrains every asset decision (no fetch, base64 budget). Test by literally double-clicking the HTML on a clean machine with no server.
- **Thresholds that would change the decision:** If you decide the *student offline file need not be interactive* (a rendered video or PDF suffices), then **Slidev becomes viable and preferable** for authoring speed — build the deck in Slidev with a `global-bottom.vue` three.js layer, ship interactive=classroom and video/PDF=student (`slidev export --per-slide`). If you *never* need a persistent cross-slide scene (each slide's 3D is independent), **reveal.js with a per-slide canvas** is the lower-effort choice. Only the *combination* of persistent scene + interactive single file forces the custom build.
- **Keep Rapier out** unless a lesson genuinely needs contact/collision dynamics; PID + spring integrators cover kinematics, control, and camera. If you do add it, use the `-compat` (base64 WASM) build so the offline target survives.

## Caveats
- **Single-file size is the main risk.** Rich video + multiple detailed robots can blow past a comfortable download size; base64's ~33% inflation has no gzip relief under `file://`. Budget assets deliberately.
- **`file://` is unforgiving:** any stray `fetch`, dynamic `import()`, worker-from-URL, or CDN-loaded module will silently break the offline build (ES modules are always fetched with CORS and cannot load cross-origin without headers). Enforce by convention and test on a real clean machine.
- **PDF export loses all interactivity by design;** the settle-detection step must be reliable or slides will screenshot mid-motion. A fixed generous per-slide wait is the safe fallback.
- **three.js moves fast** (r185 current, roughly monthly releases with migration guides); pin a version and budget occasional migration. `urdf-loader` is stable but lower-traffic — vendor a copy if long-term reproducibility matters. Reconcile the version numbers at implementation time (this doc cites three v0.185.0 and urdf-loader 0.13.0 as the latest npm-published versions; the subagent's earlier reference to 0.7.1 predates the current release).
- **Maintenance/ownership:** a custom slide engine is code you own forever. It's small (~300 lines) but is not a maintained framework with a plugin ecosystem — an acceptable trade given the unusual requirements, but a real one.
- Performance/size numbers cited (uPlot 47.9 KB / 34 ms, Plotly 3.6 MB / 310 ms, KaTeX ~348 KB, base64 ~33%) come from vendor/benchmark sources and will vary by machine and asset mix.