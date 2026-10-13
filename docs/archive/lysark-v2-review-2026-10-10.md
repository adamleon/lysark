# Lysark v2: design direction

This document records the direction set in a review session on 2026-10-10, after the project had
been dormant since July. It supersedes [lysark-design.md](lysark-design.md) where the two conflict.
Until the old spec is updated or archived, treat this document as authoritative.

Each decision is marked as one of the following:

- **Decided**: confirmed by the author.
- **Proposed**: recommended in the review, not yet confirmed. Confirm before building on it.

## 1. Why v2

v1 completed all seven milestones and works: 47 tests pass, the 4.1 MB offline file passes the
`file://` acceptance check, and the demo deck has 11 slides across three scenes. The problems are
in authoring and ownership, not in the runtime.

- **Spatial content is authored as text.** Camera framing, positions, and label offsets are typed
  coordinates. The `t` key prints spring and PID gains but not the camera pose.
- **The slide schema is closed and there is no scripting layer.** The format knows camera, joints,
  idle, slider, plot, and anchored label. Anything else (a gripper, a trajectory, a conveyor)
  requires engine changes across the compiler, the types, `main.ts`, and a widget. The `onEnter`
  and `onLeave` hooks in the v1 spec were never built. Every new lecture grows the engine.
- **The engine owns the page.** `src/main.ts` is 521 lines of module-level state, keyboard
  handlers, and wiring. It cannot be embedded in another tool, such as an editor.
- **Scenes are hand-written code.** Each scene module repeats the same channel, serialize, and
  restore setup.
- **Missing basics for a real lecture:** images and video are not embedded (the compiler passes
  `<img src>` through unchanged); only two layouts exist; one deck per build; widgets are appended
  at the bottom of the text panel with no positioning.
- **Colors are only partly themed.** CSS has tokens, but the 3D background (`0x17161b`) is
  hardcoded in four files, plot colors are hardcoded in `plot.ts`, and the demo SVG uses raw hex.
- **The PDF is raster.** `scripts/export-pdf.mjs` embeds screenshots, so text is not searchable or
  selectable and blurs when zoomed.
- **The offline check covers Chromium only.**
- **Docs drifted.** Spec §9b and §10 describe a GLB pipeline and files that were never written
  (`encode-assets.mjs`, `robot.ts`, `channels.ts`, `katex-render.ts`). The Agilus actually loads
  Collada through `?raw` imports. `ideas.md` still lists mesh robots as not built.

## 2. Requirements

### Students (Decided)

- One self-contained HTML file per lecture that runs offline from `file://` on Windows, macOS, and
  Linux.
- Interaction matters: sliders, buttons, and orbiting the camera. Slide transitions and step-wise
  reveals do not matter to students.
- A static PDF per lecture for devices where the HTML formats badly (phones) and for printing to
  write notes next to.

### Author (Decided)

- Edit lectures from several computers, sometimes from a phone, and sometimes on the classroom PC
  (last-minute fixes).
- Every lecture produces HTML and PDF automatically.
- Setting up a new computer must be easy. npm is acceptable but unfamiliar to the author.
- Firefox is the author's default browser.
- Typical workflow: commit before leaving for the lecture, then open a link on the classroom PC.
- Most scenes will be simple. Knowing the capability ceiling still matters.

### Goals behind the requirements

The author wants Unity-like authoring: a live scene to manipulate directly, scripts for custom
behaviour, and an engine that does not grow with every lecture. Drag-and-drop is secondary.

## 3. Rejected alternatives

- **Godot** (Decided against). Needs a separate export per OS, has no built-in LaTeX, makes PDF
  export custom work, and requires installing the editor.
- **Full WYSIWYG slide editor** (Proposed against). Weeks of work, larger than the engine, and
  conflicts with the layout model. Text stays text.
- **Standalone web editor with local folder access** (Dropped). The File System Access API does not
  work in Firefox or on phones.
- **One repo per engine module** (Proposed against). Adds version syncing with no benefit for a
  single developer.

## 4. Architecture

### Repositories (Decided)

- **Engine repo** (`adamleon/lysark`): runtime, build tooling, editor extension.
- **Content repo**: one per course, public. Holds lectures, assets, theme, and the build workflow.

The content repo pins the engine by git tag in `package.json`:

```json
"lysark": "github:adamleon/lysark#v1.3.0"
```

Engine changes never reach a course until the pin is updated. To roll back, change the pin.

### One engine, two shells (Proposed)

- **Player shell**: slide navigation, fullscreen, the student file. This is what ships.
- **Editor shell**: drag handles, edit mode, write-back to text. Never ships in the student file.

Both wrap the same runtime. This requires refactoring `main.ts` into a library with an explicit API:
create a player in a container, go to a slide and step, switch between edit and play mode, report
picked objects.

Math modules (PID, spring-damper, kinematics, IK) are plain functions on numbers and arrays with no
three.js or DOM dependencies. `pid.ts` and `spring-damper.ts` already follow this pattern. Such
code runs unchanged in the player, the editor, tests, and the PDF build.

### Delivery pipeline (Decided in principle)

GitHub Actions runs on every push to the content repo. Actions is free for public repos on standard
runners.

1. Install Node and run `npm ci`.
2. Build one single-file HTML per lecture folder.
3. Run the offline acceptance check. Any outside request or console error fails the workflow, and
   nothing is published. The previous version stays live.
4. Build the PDF per lecture.
5. Publish to GitHub Pages with an index page that links each lecture's HTML and PDF.

Details:

- **Pages hosts the student file itself**, not the multi-file classroom build. What is presented,
  what students download, and what the PDF comes from are the same bytes.
- **Run the offline check in Chromium, Firefox, and WebKit** (Proposed). Today it runs in Chromium
  only. Firefox treats `file://` more strictly.
- **Vector PDF** (Proposed). Print through the browser so text and KaTeX stay vector; only the 3D
  view becomes an image. Use the theme's light print variant and force the highest render quality.
- **Failure handling**: a failed run marks the commit with a red ✗ and emails the author. Check for
  the green ✓ before leaving for a lecture.

### Editing paths

- **github.dev** (press `.` on the repo). VS Code in the browser, signed in with GitHub, commits
  directly. No terminal and no preview. Works in Firefox, Chrome, Edge, and Safari. Uncommitted
  work stays in that browser.
- **github.com file editor** for phone edits.
- **Local clone** with `npm install` and `npm run dev` for the fastest loop.
- **Lysark editor extension** (section 9) adds a live preview to github.dev and desktop VS Code.

### Assets and size

- GitHub warns at 50 MiB per file, blocks at 100 MiB, recommends repos under 1 GB, and caps
  browser uploads at 25 MiB. Git keeps every version of every binary forever.
- The student file is the tighter limit: embedded assets grow by about a third (base64).
- Keep video short. Robot meshes of the Agilus size (about 3 MB) are fine.

## 5. Content repo layout (Proposed)

```
course-repo/
  package.json            pins the engine version
  lysark.config.yaml      theme, layouts, motion defaults, number format, quality
  assets/                 shared: robots, common images
  shared/                 scripts reused across this course's lectures
  lectures/
    03-pid-control/
      slides.md
      scenes/arm-cell.yaml    composition, named poses, named views
      scripts/overshoot.ts    behaviour the format can't express (optional)
      images/                 images used only in this lecture
```

- One `slides.md` per lecture by default. Allow splitting into numbered files for long lectures.
- Lecture-specific assets live with the lecture so they are deleted with it.

Code placement rule:

| Useful in | Goes in |
|---|---|
| Any course | Engine repo |
| Several lectures in this course | `shared/` in the content repo |
| One lecture | That lecture's `scripts/` |

Move code up a level when it gets reused. Do not let lecture scripts grow into a second engine.

## 6. Authoring format (Proposed)

### Slides and scene blocks

Slides are separated by `---` and keep per-slide frontmatter for slide-level settings such as
`scene` and `layout`. Scene changes go in fenced `scene` blocks in the slide body. A block's
position in the text sets when it takes effect: a block after `<!-- pause -->` applies when that
step is revealed. v1 supports per-slide targets only, so per-step targets are new engine work.

````markdown
---
scene: arm-cell
---
## Watch the overshoot

```scene
view: side
robot: home
```

Drag the setpoint and watch it ring.

<!-- pause -->
```scene
view: close-up
robot.joint2: 0.3
run: ringing
```
````

### State, not commands

Blocks describe what the scene looks like at that point, not actions. `robot: pos1` means "the
robot is at pos1 here", and the engine animates the move. Going back, jumping to any slide, and the
student file opening with every reveal shown all require that the engine can rebuild state by
reading forward from the start of the scene. Relative actions such as "rotate 30°" make that
impossible.

- State inherits forward within a scene, as v1's effective targets do. Clear a value with `none`.
- Real actions (playing a simulation) are named behaviours started with `run:`. They start when
  the step is shown and stop when it is left.
- Named views and poses live in the scene file. Slides reference them by name, so changing a view
  once updates every slide that uses it. Inline numbers stay allowed for one-off views.

### Anchors and labels

- Every link and joint in a URDF becomes an anchor automatically. v1 requires each scene to name its
  anchors.
- Labels are state, like joints and camera. A label stays until changed or cleared.
- Labels can show live values. The theme sets the number format (1,2 rather than 1.2):

```scene
labels:
  joint1: "{joint1} rad"
```

- A slide's text panel can be anchored to a node. Suitable for short callouts, not paragraphs. The
  panel follows the node through a spring-damper and stays clamped inside the screen.

### Placement, TikZ style

- Directions: `above`, `below`, `left`, `right`, and combinations such as `above right`. The label's
  matching edge sits at the anchor, offset by theme padding. CSS positions by the label's own size,
  so it stays correct when the text changes.
- Geometry in metres: `midway(joint1, joint2)`, `joint3 + [0, 0.1, 0]`. Stays attached to the
  robot from every camera angle.
- Label offsets in screen pixels: `above` means above on screen, regardless of camera.
- Anchoring to objects: "above the robot" uses the object's bounding box projected to the screen,
  like TikZ `above=of A`.
- Screen edges: if a label doesn't fit, flip it to the other side or shift it inside (the Floating
  UI approach).
- Overlap: warn in the dev view; resolve by hand. No automatic layout in the first version.
- Lines and arrows between anchors (dimension lines, label leaders) are drawn in a 2D overlay over
  the scene so they stay sharp.

### Widgets

Sliders and plots use the same block syntax and appear where they are written in the text, like an
image. A block after a pause appears with that step.

````markdown
```slider
bind: joint2
label: Shoulder setpoint
range: [-1.5, 1.5]
```
````

- `place:` selects a layout region defined by the theme (for example `right`).
- A widget can be anchored: a slider next to the joint it controls.

### Images

- Images referenced from slides are embedded at build time.
- A missing file or a web URL fails the build with a message that names the slide. Today the build
  is silent; only the offline check catches it, and it reports the path but not the slide.
- Save images found online into the repo instead of linking them.

## 7. Scene files (Proposed)

A scene is split the way Unity splits it:

- **Scene file** (YAML, data): which assets, their poses, extra objects, lights, material roles,
  named poses, named views. The editor reads and writes this file.
- **Scripts** (TypeScript): only behaviour the format can't express, referenced by name.

Most lectures should need no scripts.

## 8. Scripts (Proposed)

- TypeScript, so the engine API autocompletes in the editor.
- Lifecycle functions only: start (step entered), frame (each frame), stop (step left). Scripts
  must not create timers or change state outside these functions. The editor jumps between steps
  in any order and exposes violations.
- The script API is the contract every lecture depends on. Keep it small and version it from the
  start.

## 9. Theme (Proposed)

`lysark.config.yaml` defines a palette of actual colors and roles that point to them:

```yaml
palette:
  red: "#ff3b3b"
  cheese: "#f5c542"
  green: "#33e17c"
  cream: "#f3eee7"
roles:
  emphasis: cheese
  setpoint: cheese
  measured: red
  error: green
  robot: red
print:
  background: "#ffffff"
  text: "#1a1a1a"
```

Roles apply everywhere:

- **Text**: bold gets `emphasis`; headings get the accent.
- **Math**: the theme generates KaTeX macros such as `\setpoint{\theta^*}`.
- **Plots**: series colored by what they show.
- **SVG diagrams**: role names instead of hex codes.
- **3D**: scene files assign roles to objects, such as `material: robot`.

The same role across equation, plot, and 3D (θ* in the equation, the setpoint line, a ghost robot)
links them for students without explanation.

Rules:

- Every color goes through the theme. Remove the hardcoded colors listed in section 1.
- Markers that must match exactly (setpoint ghost, arrows, coordinate frames) use unlit materials.
  Lit robot bodies match in hue only.
- Imported models: per model, keep original materials or map them to roles by material name,
  falling back to color.
- The print variant is light. The PDF build uses it, including the 3D background.

### Shading and quality

- three.js supports PBR materials, HDR environment lighting, soft shadows, tone mapping, and
  post-processing. A procedural studio environment adds realism at zero file size; real HDR images
  cost 1 to 4 MB each in the student file. v1 uses only standard materials, two lights, and
  shadows.
- **Default to a stylized look** (Proposed): toon or flat shading with outlines (`MeshToonMaterial`
  plus an outline effect). Clearer for teaching, keeps role colors true, and separates robot links
  visually. Allow realistic shading per scene. Set the style in the theme.
- **Adaptive quality** (Proposed, low priority). Measure frame time while a scene renders; do not
  guess from GPU names (Firefox and Safari blur them). Lower settings in this order: device pixel
  ratio, post-processing, shadows, anti-aliasing. Use hysteresis. Change only between slides. Allow
  a manual override such as `#quality=high`. Force the highest quality in the PDF build, because
  the CI browser renders without a GPU. Build this when the first heavy scene appears.
- The device pixel ratio cap of 2 is not a resolution cap. On a 4K screen Lysark renders full 4K at
  any OS scaling. The cap only affects screens with a ratio above 2, mostly phones.

## 10. Editor (Proposed)

A VS Code web extension that runs in github.dev and desktop VS Code. The text editor sits on the
left, a Lysark preview on the right. Text files stay the only source of truth: every action in the
preview becomes an ordinary text edit, so undo works and commits show exactly what changed.

Sync:

- **Text to preview**: recompile and update in place as you type. Keep the last valid state while
  the text is invalid and show the error.
- **Cursor to preview**: the cursor's slide and step are shown. Clicking a slide moves the cursor.
- **Preview to text**: edits are written into the file at the right place, preserving formatting
  and comments (the `yaml` library's document API keeps comments).

Modes:

- **Edit mode** jumps straight to targets (no waiting for PID settle), with a free camera and drag
  handles.
- **Play mode** shows the slide exactly as students see it.

The preview must run the engine version the content repo pins. github.dev has no npm, so the engine
repo publishes each version's runtime to its own Pages site and the preview loads the pinned one.
Running lecture scripts in the preview requires compiling TypeScript in the browser.

Build order (each step useful on its own):

1. Read-only preview with cursor sync.
2. Save camera views (named view in the scene file, or `view:` at the cursor).
3. Move and rotate handles that write to the scene file.
4. Robot posing by joint or by dragging the end effector with IK.
5. Drag-and-drop assets from `assets/` into the scene.

Steps 1 and 2 are estimated at one to two weeks with Claude Code; the full list at about a month.
The editor is not usable on phones.

## 11. Engine work list

- Engine as a library (player API), splitting `main.ts`.
- Build a deck from an external lecture folder; one build per lecture.
- Content repo template with the Actions and Pages workflow.
- Image and video embedding with build errors that name the slide.
- Multi-browser offline check.
- Vector PDF with the print theme.
- Theme file: palette, roles, KaTeX macros, print variant, number format, shading style.
- Scene files as data; automatic anchors from URDF links and joints.
- `scene` blocks tied to reveal steps.
- Labels as state, live values, TikZ-style placement, lines and arrows.
- Widget blocks in the text flow, layout regions, anchored widgets.
- Script API with lifecycle functions.
- IK as plain math (a Jacobian-based IK can double as course material).
- Editor extension (section 10).
- Later: adaptive quality.

## 12. Roadmap (Proposed)

### Step 0: Documentation

Commit this document. Update `CLAUDE.md` to point here. Archive or update `lysark-design.md` and
fix `ideas.md`, so Claude Code does not follow outdated instructions.

### Step 1: Vertical slice of the pipeline

Create the content repo with one lecture (port the current demo deck unchanged). Make the engine
build a deck from that external folder. Set up the GitHub Actions workflow: build, offline check,
PDF, publish to Pages. Keep the existing scene modules in the engine for now.

This delivers the commit-then-open-a-link workflow on the current engine, forces the
engine/content split early, and from then on every engine change is tested against a real lecture.

### Step 2: Engine as a library, theme, images

Refactor `main.ts` into the player API. Add the theme file and remove hardcoded colors. Add image
embedding with build errors. Add the multi-browser check and the vector PDF.

### Step 3: Authoring format v2

Scene files, `scene` blocks per step, labels and placement, widget blocks. Port the demo deck to the
new format as the test case.

### Step 4: Script API and IK

### Step 5: Editor extension

In the build order from section 10.

Throughout: author one real lecture as early as possible. It shows which missing features matter.

## 13. Open questions

- Labels as forward-inherited state (proposed) or per slide (v1 behaviour)?
- Exact grammar for `scene` blocks: YAML (proposed), or something closer to the `robot.moveTo()`
  style the author first sketched, with state semantics?
- Inline numbers versus named views and poses as the default style?
- Publishing the editor extension: VS Code Marketplace publisher account and update flow.
- In-browser TypeScript compilation for scripts in the editor preview.
- Whether the student file should open with every reveal shown and the camera free (suggested,
  since transitions and reveals don't matter to students).
- Content repo naming: one repo per course.
