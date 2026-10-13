# Lysark — future ideas backlog

Non-authoritative. [docs/lysark-design.md](lysark-design.md) is the spec and the committed
scope; this file is a growing list of candidate features and extensions we've discussed but not
scheduled. Items here are ideas, not commitments — promote one into a milestone/spec change when
we decide to build it. Newest ideas near the top of their section.

## Build & assets

### Mesh-based URDF robots in the single file (spec §9b, not yet built)
The current arm is primitive geometry only, so the offline build needed no mesh pipeline. A real
mesh robot (GLB) still works in the SAME single file — no student/teacher model swap. Mechanism:
`scripts/encode-assets.mjs` base64-encodes each GLB at build time; the runtime loads via
`URDFLoader.parse(urdf)` with a custom `loadMeshCb` that runs `GLTFLoader.parse(arrayBuffer, '', …)`
on the in-memory buffer instead of fetching — so `package://` refs resolve from memory, no fetch,
`file://`-safe. Textures embed inside the GLB (best) or as `data:` URIs. Prefer GLB; avoid Collada
(references external textures). The real constraint is SIZE, not feasibility: base64 +33%, no gzip
under `file://`, budget < ~50 MB (§13). Mitigations: down-res textures, Draco/meshopt with the
decoder INLINED (Draco's default decoder is fetched/worker-loaded → must be embedded, like the
Rapier-compat WASM approach in §2), fflate for the largest blobs. Escape hatch if one model is too
heavy for the single file: build modes can ship a lighter offline variant — but avoid it, since
"what students see == what you present" is the point. Scope when a mesh robot is actually added.

## Widgets & content

### Curve / trajectory widget (path-planning plots)
Today's `plot` widget is a scrolling **time-series of one live channel**; it cannot draw y = f(x)
over a domain. Add a `curve` plot mode for drawing functions — motivated by path planning
(3rd/5th-order polynomial trajectories). Scope:
1. **`curve` mode** — declarative for polynomials: `domain: [0,1]`, `samples: N`, coefficients as
   data (`poly: [...]`), evaluated over a grid → uPlot `[xs, ys]`. A built-in `quintic` primitive
   that solves coefficients from boundary conditions (q0/qf/v0/vf/a0/af) so the standard
   path-planning case stays declarative. Arbitrary f(x) needs the named-function hook (below).
2. **Parameter store** — a named `Record<string, number>` distinct from motion channels, so a
   `slider` can `bind: param.a3` (or a boundary condition) and drive the curve live.
3. **Looping marker** — an overlaid point series advanced each frame to s = (t mod T)/T along the
   domain; a dot traces the curve and loops. Reuses M5's `onFrame`/`dispose` widget contract.
4. **Overlay-only ticker** (see below) so an animated curve also works on scene-less slides.

Compelling extension: drive a joint's **PID setpoint from the planned trajectory** so the planned
path and the actual (overshooting) joint response are plotted together — ties trajectory
generation directly into the control-theory spine of the deck.

### Static-data plots on scene-less slides (M5 deferral)
Spec §8 allows plots on scene-less slides carrying **static** data (frontmatter or asset), not a
live `bind:`. M5 built only live/bound plots and the compiler forbids widgets on scene-less
slides. Add a static-data plot path: a `data:` field, a carve-out in the scene-less guard for
static plots only, and a render-once (non-sampling) path.

## Engine & authoring

### General `onEnter` / `onLeave` hooks (M5 deferral)
Spec §8's escape hatch: a slide names a function exported by the scene module (`hooks` map) /
deck-level map, invoked on enter/leave, for behavior declarative syntax can't express. Needs
`hooks` on `SceneModule` + deck, `onEnter`/`onLeave` on `CompiledSlide`, and engine plumbing that
resolves name → function and tears down per-frame callbacks on leave (careful with navSeq
supersession). Prerequisite for arbitrary-function curve plots and scripted gestures.

### Overlay-only ticker for scene-less animated overlays
Spec §4 anticipates "a lightweight overlay ticker (its own rAF) that steps only the overlay
channels — widget springs, static-plot transitions — and self-suspends when settled." M5's live
widgets ride the scene render loop, so they freeze on scene-less slides (the loop stops when
settled). Build the standalone overlay ticker so animated overlays (curve markers, widget
springs) run without a scene while still honoring "zero rAF work at rest" (§3).
