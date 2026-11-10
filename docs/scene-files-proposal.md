# Scene files: proposal

Step 3 of [lysark-v2.md](lysark-v2.md) designs the scene file format before the editor writes
named views and poses. **Decided 2026-10-16: all eight decisions as recommended** (recorded in
lysark-v2.md section 8); **decision 9, models, decided 2026-11-09 as recommended**. It is built
in the steps below. Step 1 is released (2026-11-03: extension 0.3.0, engine v2.4.0;
[editor-host.md](editor-host.md)). Step 2, named views, is released (2026-11-04, engine v2.5.0);
the format reference is [scene-files.md](scene-files.md). Steps 3 to 7 are released (2026-11-09) and
were tried in github.dev on the course lecture the same day: step 3, Save view as… (engine
v2.6.0); step 4, named poses (v2.7.0); step 5 in three parts, as V did across steps 2 and 3: 5a,
the joint sliders (J) and P (v2.8.0), 5b, Shift+P, "Save pose as…" (v2.9.0), and 5c, dragging the
tool with inverse kinematics (v2.10.0); step 6, objects written by hand (v2.11.0); step 7, drag
handles for objects (v2.12.0). Step 8, models from STL and untextured GLB files, is built
(2026-11-09, engine v2.13.0, no extension change), not yet released; how to write them is in
[scene-files.md](scene-files.md#models). Its proposals are [below](#proposals-from-step-8).
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
8. **Models from `assets/`** (STL, and GLB without textures), with a size limit per file. As
   decided (decision 9), from the lecture folder too, as images are: `model: <path>` with `unit`
   and `up`, at most 5 MB per file.
9. **Textured models**, only once the engine frees textures when a scene is put away (it doesn't
   today) and they load without a network request, checked in both browsers. The released panel
   blocks the loader's way of loading them; see [Proposals from step 8](#proposals-from-step-8).

Left for when a lecture needs them: a start state per scene run, a second robot or a moved robot
in one scene, showing or moving objects per slide, and scene files shared between lectures.

## Decisions for the author

Each has a recommendation; the names in 3 and 9 are permanent once lectures use them.

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
9. **Models** (needed before step 8; **decided 2026-11-09, all four parts as recommended**):
   - *The words.* `model: <path>`, a shape like `box:`, plus `unit: mm | cm | m` (without it, m)
     and `up: y | z` (without it, y), allowed only with `model`. An STL has no unit: CAD programs
     usually write millimetres, ROS meshes metres (REP 103). ROS meshes and many CAD programs have
     z up, and `rotate` alone can't stand a z-up part up, since the underside is measured before
     the turn. Both keys describe the file, so the scene stays y up in metres, as decision 7 has
     it. `mesh`, `stl` and `glb` get "Did you mean 'model'?", and `scale` its own message pointing
     to `unit`.
   - *Where the files are.* As for images: the path is from the lecture folder (where `slides.md`
     is), and the file is in the lecture folder or `<course>/assets/` (`models/x.stl`,
     `../../assets/x.stl`). It is the rule the course README teaches for images, the build and the
     extension already resolve exactly these two roots, and the engine's demo can have a model in
     CI (its `/assets/` is not in git).
   - *The size limit.* 5,000,000 bytes per file on disk, no total per lecture for now. About
     100,000 triangles as binary STL, far under the extension's own 32 MB, so the lecturer gets the
     engine's advice. It bounds the one cost not yet measured: every fresh panel page in github.dev
     reads every model again.
   - *The course repo.* A small commit of its own once the course runs v2.13.0: a `.gitattributes`
     with `*.stl binary` and `*.glb binary` (with `core.autocrlf` on, a text STL would otherwise
     change size between Windows and CI), and a "Models" paragraph in the README (paths, `unit`
     and `up`, 5 MB, no Git LFS). The engine repo has the same `.gitattributes` from step 8.

## Also checked

- Today's compiler rejects a name in `camera:`, `joints:` and trajectory `from`/`to` ("must be a
  mapping"), so allowing names there can't change a lecture that builds now.
- Unknown top-level slide keys are ignored today; only keys inside `camera:`, widgets and
  `anchored:` are checked.
- The camera spring carries forward per key (`src/engine/camera-merge.ts`).
- The scene teardown frees geometry and materials but not textures (`src/scene/dispose.ts`),
  which is why textured models wait for step 9.

## Proposals from step 8

Not built; each would be its own small change, landed and understood before a lecture uses it.

At minimum priority, because they go against confirmed decision 7 (colours as named presets;
`at` at the middle of the underside):

- **A GLB's own colours** (`material: file`). Keep the file's materials instead of a preset. It
  needs checks of its own (a metallic or see-through material that shows black or empty under the
  stage's lights), and the colours would not follow the theme, so the print PDF could show a
  white part on the white page.
- **The file's own origin** (`origin: file`). Place a model by the origin it has in the file
  instead of the middle of its bounding box's underside. It helps a tool part drawn around its
  flange that isn't symmetric about the tool's axis, which today sits off the axis by that much
  until `at` moves it.

For the future:

- **`unit: in`** (and `up: x`, should a file need it). Rare in this course; either can be added
  without changing a lecture.
- **One parse per file.** Each object decodes and parses its own copy of its file when the scene
  is first shown: for a 5 MB binary STL in headless Chromium, about 30-55 ms per object (about
  10 ms decoding the base64, the rest parsing and creasing). So two objects showing one file hold
  two copies of its geometry, and the build parses a file shown in two units twice. Sharing one
  parse saves that, but shared geometry is a trap for any later change that edits a model in
  place. Worth it only once a lecture shows a large file many times.
- **A total per lecture.** Only each file is limited today (5 MB). A lecture with many models
  grows the student file by about 4/3 of their total, and every fresh panel page in github.dev
  reads them all again. A total (say 20 MB) can be added without changing a lecture under it.
- **Image paths the panel can't read.** For a model, the compiler refuses a folder or file name
  starting with '.', a name with ~ and a digit, and a ':', and the build a path through a link,
  since extension 0.3.0's panel won't read them. An image path with any of them still builds,
  but the panel leaves the image out, under "Images not shown:", with the reason "outside the
  lecture folder and the course's assets/ folder". The compiler could refuse them for images as
  it does for models (and the build a link), so the build and the panel agree and the message
  says what to rename. A lecture with such a path would then stop building, so the course's
  lectures need checking first.
- **A GPU-memory check in check-offline**, before step 9. On a slide without a scene, after every
  scene has been shown, three's count of geometries and textures (`renderer.info.memory`) should
  be what it was before the first one. Today the one-scene rule (lysark-design.md §4.1) rests
  on `dispose.ts` freeing everything a scene can hold; step 8 keeps to what it frees by refusing
  the rest, and checks that with a unit test. Textures change that, so this guard comes first,
  as its own small change.
- **`dispose.ts` for more than meshes**: textures with step 9, and lines, points, bones and GPU
  instancing if a later step keeps them in models (today they are taken out or refused).
- **Step 9's blocker: the released panel's security rules.** Extension 0.3.0's panel page allows
  images from `blob:` addresses (`img-src data: blob:`), but not fetching them (`connect-src` has
  no `blob:`). three.js's glTF loader turns a GLB's images into `blob:` addresses and loads them
  with `ImageBitmapLoader`, which fetches, so in the panel every texture would fail (and the
  student-file check, `scripts/check-offline.mjs`, fails on any `blob:` request). Textured models
  need either their images loaded through an `<img>` element from a `data:` address (three's
  `TextureLoader`; the panel's `img-src` and the student-file check both allow `data:`), or an
  extension release that allows `blob:` in `connect-src`, with the check taught the same. Either
  way also textures in `dispose.ts`, and `parseModel` (`src/scene/models.ts`) must let the
  loader have its images: today its loading manager refuses every address, `blob:` included.
