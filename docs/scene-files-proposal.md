# Scene files: proposal

Step 3 of [lysark-v2.md](lysark-v2.md) designs the scene file format before the editor writes
named views and poses. **Decided 2026-10-16: all eight decisions as recommended** (recorded in lysark-v2.md section 8).
Nothing here is built yet; it is built in the steps below.
It came from four independent designs (smallest change, editor-first, lecturer-first,
engine-first), scored by three reviewers and combined; the claims about today's code were
checked against the code.

## In short

A lecture can have a file `scenes/<name>.yaml` next to `slides.md`. It starts from one of the
engine's scenes (`base: agilus`) and adds **named camera views**, **named robot poses** and, later,
**simple objects** (tables, workpieces, frames, invisible points to label). A slide writes a name
wherever it writes numbers today: `camera: oversikt`, `joints: q0`, `from: q0`. The build turns
the names into today's numbers, so the student file, the slide engine and every existing lecture
stay as they are. The editor saves a view or pose to wherever the slide gets it from: the named
entry, or the slide itself.

## What it looks like

`lectures/baneplanlegging/scenes/agilus.yaml` (abridged):

```yaml
base: agilus                 # the engine scene this builds on: the KUKA, floor and lights

views:                       # a view is a whole camera: lookAt, offset, optional spring
  tittel:
    lookAt: [-1.75, 0.5, 0]
    offset: [0.7, 1.2, 3.6]
  nært:                      # close enough to read the q vector
    lookAt: [-0.5, 0.62, 0]
    offset: [1.15, 0.72, 2.6]
    spring: { omega: 5, zeta: 1.0 }
  oversikt:                  # no spring: the default, omega 4, zeta 1
    lookAt: [-1.1, 0.55, 0]
    offset: [0.6, 1.5, 3.2]

poses:                       # q = [q1 … q6] in radians, in joint order
  konfigurasjon: [0.3, -0.6, 0.9, 0.0, 0.9, 0.0]
  q0: [-1.5, -0.5, 1.3, 0.0, 0.7, 0.0]
  qf: [ 1.5, -1.6, 0.4, 0.0, 1.3, 0.0]
  vri: { joint_4: 1.2, joint_6: -0.8 }      # only these two joints

objects:                     # a later step
  hentebord:
    box: [0.4, 0.2, 0.4]     # width, height, depth in metres
    at: [0.05, 0, -0.74]     # middle of its underside, so it stands on the floor
    material: wood
  xA:                        # no shape: an invisible point to look at or label
    at: [0.29, 0.47, -0.76]
```

And in `slides.md`:

```markdown
---
id: konfigurasjon
scene: agilus
joints: konfigurasjon
camera: nært
---
…
---
id: bane
scene: agilus
camera: oversikt
trajectory:
  control: slider
  from: q0
  to: qf
---
```

The slides keep `scene: agilus`. The file `scenes/agilus.yaml` is this lecture's version of it.

## The rules

- **Which scene.** `scene: X` uses `scenes/X.yaml` if the lecture has one, otherwise the engine
  scene X. The lecture's file wins, so a future engine scene can never change an existing lecture.
  `base:` is required, so a file can't silently drop the robot.
- **Scenes still behave the same.** A file with only `base: agilus` is exactly the engine scene.
  Everything the engine scene does (IK for the Lin slide, the ghost robot) keeps working. A new
  robot or new behaviour is still engine work.
- **A name or values, never both.** A slide writes `camera: oversikt` or a `camera:` block, not a
  mix. Each slide then has exactly one place its camera and joints come from.
- **A named view is the whole camera.** It flies the same from any slide, with its own spring or
  the default. That ends today's repeated `spring:` lines: baneplanlegging repeats
  `spring: { omega: 4, zeta: 1.0 }`, the default, on nine slides only to stop slide 2's omega 5
  from carrying on. An inline `camera:` block still merges with the carried camera, as today.
- **A named pose sets the joints it lists**, like an inline `joints:` block. A list sets all joints
  of q in order; the build checks its length and the robot's joint limits (today an out-of-range
  value is clamped without a word).
- **Carry-forward is unchanged.** Names become numbers when the lecture is built, and later slides
  inherit them as they inherit numbers today.
- **Errors name the file, the line and what to do.** For example, a name on a slide whose scene
  has no file says how to create one.
- **Numbers stay allowed everywhere.** Names are an option, never a requirement.

## What the editor does

- **V on a slide that says `camera: oversikt`** updates the view `oversikt` in the scene file. A
  banner lists every slide that changed with it. **V on a slide with its own `camera:` block**
  writes into the slide, as today. The panel's hint line says where V will write before you press
  it.
- **Shift+V, "Save view as…"** offers: only this slide; an existing view (with the slides that use
  it); or a new view. A new view creates `scenes/<scene>.yaml` if the lecture has none.
- **Poses** work the same way with P and Shift+P, once the panel can pose the robot (joint sliders,
  later dragging the tool with IK).
- **Objects** get drag handles in a later step; they write `at` and `rotate` in the scene file.
- **Every edit** is computed on the file's current text (unsaved typing included), changes only the
  values it saves, and is refused rather than reformatting anything.
- **The editing code moves into the panel** (loaded from the course site), and the extension
  becomes a plain host: read a file, apply an edit, ask a question. After one more extension
  release, new editor features arrive with the engine through Update engine, like everything else.

## The steps

Each step lands on its own, with a note and coverage in the demo lecture, as steps do now.

1. **Finish the thin host.** No format change. Extension 0.3.0 (the last planned extension
   release) and engine v2.4.0. It brings real images in the panel instead of grey boxes, and V
   correct even over unsaved typing. 0.3.0 still works with courses on v2.3.x.
2. **Named views, written by hand.** Baneplanlegging's camera blocks can become names; V updates
   a named view in place.
3. **Save view as…** Shift+V, including creating the scene file. Checked in github.dev before
   release (a two-file edit and its undo).
4. **Named poses, written by hand.** `from: q0`, `to: qf`, `joints: konfigurasjon`.
5. **Pose the robot in the panel.** Joint sliders, P and Shift+P; then dragging the tool with IK.
6. **Objects, written by hand.** Boxes, cylinders, spheres, coordinate frames, invisible points.
7. **Drag handles** for objects.
8. **Models from `assets/`** (STL, and GLB without textures), with a size limit per file.
9. **Textured models**, only once the engine frees textures when a scene is put away (it doesn't
   today) and they load without a network request, checked in both browsers.

Left for when a lecture needs them: a start state per scene run, a second robot or a moved robot
in one scene, showing or moving objects per slide, and scene files shared between lectures.

## Decisions for the author

Each has a recommendation; the names in 3 are permanent once lectures use them.

1. **How a slide uses a name.** (a) Where values go: `camera: oversikt`, `joints: q0`.
   (b) New keys `view:` and `pose:`, with `camera:`/`joints:` on top. *Recommended: (a).* Today's
   engine rejects (a) loudly but would silently ignore (b), and (a) leaves each slide one source for
   its camera, so V always knows where to write.
2. **Where V writes on a slide that names a view.** (a) Into the named view, with the banner.
   (b) Into the slide, replacing the name with numbers. (c) Ask every time. *Recommended: (a),*
   with "only this slide" one Shift+V away. Tuning a shared view once is the usual wish; (c) is
   slow during a hot fix.
3. **Words in the file.** `base` / `views` / `poses` / `parent` / `at` / `rotate` / `material`, or
   alternatives such as `extends`, `configs` (configuration q versus pose x), `position`/`rotation`.
   *Recommended: the first set.* Plain words, and "pose" matches the teach pendant.
4. **How a pose is written.** (a) A q list in joint order, or a mapping for some joints. (b) Always
   a mapping. *Recommended: (a).* It reads like the q in the lecture and is one line.
5. **A start state per scene run** (`start: { camera: …, joints: … }`). *Recommended: not now.* The
   first slide of a run names its view instead; it can be added later without changing anything.
6. **Where the editing code lives.** (a) In the panel, with the extension as a plain host.
   (b) In the extension, one Marketplace release per editor feature. *Recommended: (a).*
7. **Object conventions** (needed before step 6). Height as the middle number (y up, as in
   `camera:` today) or the last (z up, as in robotics); `at` at the middle of the underside or the
   centre; turns in degrees or radians; colours as named presets or colour codes. *Recommended:
   y up, underside, degrees, presets.* Values can then be pasted between `camera:` and objects,
   and presets can follow the theme later.
8. **A typo in a slide key becomes an error.** Today `camrea:` is ignored without a word.
   *Recommended: yes, for every slide, from step 2.* Both existing lectures use only known keys
   (checked). Strictly, this bends the rule that engine changes never require editing a lecture,
   but only for a key that never did anything.

## Also checked

- Today's compiler rejects a name in `camera:`, `joints:` and trajectory `from`/`to` ("must be a
  mapping"), so allowing names there can't change a lecture that builds now.
- Unknown top-level slide keys are ignored today; only keys inside `camera:`, widgets and
  `anchored:` are checked.
- The camera spring carries forward per key (`src/engine/camera-merge.ts`).
- The scene teardown frees geometry and materials but not textures (`src/scene/dispose.ts`),
  which is why textured models wait for step 9.
