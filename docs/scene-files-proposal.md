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
handles for objects (v2.12.0). Step 8, models from STL and untextured GLB files, is released
(2026-11-12, engine v2.13.0, no extension change); how to write them is in
[scene-files.md](scene-files.md#models). Its proposals are [below](#proposals-from-step-8).
**Decision 10, textured models, decided 2026-11-25**, confirmed by the author on 2026-11-26 with
answers to step 9's questions. Step 9 is built (2026-11-25, and the answers 2026-11-26, engine
v2.14.0, no extension change), not yet released: `material: file` shows a GLB in its own colours
and textures ([scene-files.md](scene-files.md#a-glbs-own-look-material-file)). Its proposals are
[below](#proposals-from-step-9).
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
   *Built 2026-11-25 as decided (decision 10), in two parts:* 9a, `dispose.ts` frees textures
   and `lysark check` checks GPU memory; 9b, `material: file` (engine v2.14.0). The images load
   from `data:` addresses into `<img>`s, with no request and no `blob:` address, checked in
   Chromium and Firefox, in the student file, the editor check and the released extension 0.4.0
   in VS Code for the web. After its review and a hands-on test (2026-11-26): a JPEG's size is
   read as the browsers' libjpeg reads it, so a larger image can't hide; the panel shows a file
   to the objects that read it a way that passes; messages say what to do in Blender; and
   `lysark check` waits for a slow scene before looking for three's lighting table. After the
   author's answers (2026-11-26, decision 10): a file's textures may have at most 16,777,216
   pixels in all, cut-out materials (alpha clip) are shown, their shadows cut out too, and a mesh
   without a material is grey.

Left for when a lecture needs them: a start state per scene run, a second robot or a moved robot
in one scene, showing or moving objects per slide, and scene files shared between lectures.

## Decisions for the author

Each has a recommendation; the names in 3, 9 and 10 are permanent once lectures use them.

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
10. **Textured models** (needed before step 9; **decided 2026-11-25**; **confirmed 2026-11-26**,
    with the author's answers to step 9's questions below):
   - *Its own look only when asked.* A model keeps its file's look (its materials: colours and
     textures) only when the scene file says `material: file`. Without a `material:` line a model
     gets the preset as before, but a GLB with textures and no `material:` line stops the build,
     at the scene file's line, saying to write `material: file` to show them or a preset to colour
     it. `material: file` on an STL is an error (an STL has no materials). On an untextured GLB it
     keeps the file's own colours (the step-8 proposal "A GLB's own colours"). With a preset
     written, the file's materials and textures are ignored, as before.
   - *Size.* A texture larger than 2048 pixels on a side is refused, with a message naming the
     image and its size. The 5,000,000-byte limit per model file stays; textures count in it.
     *Confirmed 2026-11-26:* the words relayed to step 9's review, "refuse textures", meant
     textures over 2048 pixels, as built, not every texture.
   - *A total per file* (the author's answer, 2026-11-26). The images a file's materials use
     through their textures may have at most 16,777,216 pixels in all, four 2048 × 2048
     textures' worth (about 90 MB of GPU memory with mipmaps), and an image no texture of a
     material uses doesn't count. Read from the same PNG and JPEG headers; only with
     `material: file` (a colour leaves the textures out). The message names the file, the total
     and the limit, and says to use fewer or smaller textures, at the `model:` line, in the
     build and the panel alike. Without it a 5 MB file could hold hundreds of flat 2048-pixel
     PNGs, gigabytes on the graphics card.
     *Counted as copies, after the answers' review (2026-11-26), for the author to confirm:*
     first each image counted once, however many textures or materials used it. But three
     uploads an image again for each filter and wrap its textures read it with (glTF's sampler;
     Blender's Interpolation and Extension), and again without sRGB where a normal map or other
     data reads it through a texture of its own, so a 228 kB file reading one flat 2048-pixel
     PNG through 108 samplers passed while holding about 2.4 GB. Now each copy the graphics card
     holds counts (measured in Chromium and Firefox; where a copy may or may not be in sRGB it
     counts, so the count is never under). A Blender file holds one copy of each image unless
     two Image Texture nodes give one image different Interpolation or Extension. The limit
     itself is unchanged.
   - *Accepted with them:* PNG and JPEG textures only, inside the `.glb` (no files beside it, as
     step 8 requires); KTX2/Basis (`KHR_texture_basisu`, which needs a decoder in a worker, which
     the `file://` rule forbids), WebP (`EXT_texture_webp`) and anything else refused with a
     message. The images load from inside the file without a network request and without `blob:`
     fetches, so the released panel (extension 0.4.0, `connect-src` without `blob:`) shows them
     with no extension release, and the student-file check (which fails on `blob:` requests)
     passes.
   - *Cut-out materials* (the author's answer, 2026-11-26): allowed. A material with alpha mode
     MASK (Blender's alpha clip) is drawn in the opaque pass, each point shown or left out by its
     alpha against the cutoff, so a sticker or a sign can have a transparent surround; its shadow
     is cut out the same (three r185 does it for a textured material; the colour's own alpha is
     moved into the test so the shadow follows it too). Blended materials (BLEND) stay refused,
     with a message that names alpha clip for a transparent surround.
   - *A mesh without a material* (the author's answer, 2026-11-26) is grey, the `grey` preset,
     which follows the theme, as Blender shows such a mesh; the file's own materials show on the
     rest. It was refused, as three.js gives it a fully metallic default, near black on the stage.

## Also checked

- Today's compiler rejects a name in `camera:`, `joints:` and trajectory `from`/`to` ("must be a
  mapping"), so allowing names there can't change a lecture that builds now.
- Unknown top-level slide keys are ignored today; only keys inside `camera:`, widgets and
  `anchored:` are checked.
- The camera spring carries forward per key (`src/engine/camera-merge.ts`).
- The scene teardown freed geometry and materials but not textures (`src/scene/dispose.ts`),
  which is why textured models waited for step 9 (it frees them from step 9a).

## Proposals from step 8

Not built; each would be its own small change, landed and understood before a lecture uses it.

At minimum priority, because they go against confirmed decision 7 (colours as named presets;
`at` at the middle of the underside):

- **A GLB's own colours** (`material: file`). Keep the file's materials instead of a preset. It
  needs checks of its own (a metallic or see-through material that shows black or empty under the
  stage's lights), and the colours would not follow the theme, so the print PDF could show a
  white part on the white page. *Decided with decision 10 and built in step 9 (2026-11-25), with
  those checks; the theme caveat is in scene-files.md.*
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
- **The panel's cost per fresh page.** With a 5 MB STL, every fresh panel page (opening the
  panel, and every save but a camera or pose change) took 0.25-0.4 s longer locally with a GPU
  (2026-11-10): the extension's `bytesToBase64` about 100 ms, the panel's check about 60 ms, and
  the deck's own parse of the same file about 50 ms. The author noticed no difference in
  github.dev (2026-11-12). If a lecture with several large models makes saves slow, three ways
  to cut it: hand the check's parse to the deck instead of parsing twice; encode with Node's
  `Buffer` where it exists (desktop VS Code, about 2 ms; github.dev runs the extension in the
  browser, where it doesn't); or have the extension keep each file's last read between panel
  pages (an extension release).
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
- **A GPU-memory check in check-offline**, before step 9. *Built in step 9a (2026-11-25).* On a
  slide without a scene, after every scene has been shown, three's count of geometries and
  textures (`renderer.info.memory`) must be what it was before the first one. The one-scene rule
  (lysark-design.md §4.1) rests on `dispose.ts` freeing everything a scene can hold; this checks
  it in every student file (`lysark check`, so course CI too). One texture is allowed on top,
  and only it: three r185's own lighting table (`DFG_LUT`, 16 × 16), which the renderer makes at
  the first frame with a lit material and keeps for the page, whatever scene comes or goes. A
  lecture without a slide without a scene isn't checked (the check says so).
- **`dispose.ts` for more than meshes**: textures with step 9, and lines, points, bones and GPU
  instancing if a later step keeps them in models (today they are taken out or refused).
  *Textures, lines and points built in step 9a:* every texture a material holds (any
  texture-valued property, and a ShaderMaterial's uniforms), each geometry, material and texture
  freed once however many share it. Bones and GPU instancing are still refused.
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
  *Settled in step 9 the first way, with no extension release (extension 0.4.0 has the same
  rules):* each image's bytes become a `data:` address before the loader reads the file, the
  manager lets exactly those through, and three's `TextureLoader` loads them into `<img>`s.

## Proposals from step 9

Not built; each would be its own small change, landed and understood before a lecture uses it.
The author answered step 9's questions on 2026-11-26 (decision 10).

- **A switch for the size limits** (asked by the author, 2026-11-26: of no use for lectures,
  but for other kinds of presentations, or for testing). The limits on a model are 5,000,000
  bytes per file, 2048 pixels on a texture's side and 16,777,216 texture pixels per file; the
  model's size between 1 mm and 10 m is not one (it catches a file read in the wrong `unit`), and
  VS Code's own 32 MB per file read is the extension's, which the panel can't lift.
  *Recommended:* a key in the text the compiler reads, so the build, the panel and course CI
  agree: `limits: off` at the top of a scene file, for the models in it. The compiler would
  report it with each model, as it reports its look, and `checkModel` would skip the three
  limits for those. A command-line flag instead would let `lysark build` pass a file the panel
  refuses. Not built: a new key, the author's to name, and it lets a student file hold more
  than a student's laptop may manage.
- **The build names slides.md for a model problem** (from before step 9). A model problem stops
  the build with Vite's trailer `file: …/slides.md`, though the problem is in a scene file, and a
  compile error starts with "Could not load virtual:lysark-deck (imported by …/src/main.ts)". The
  message itself names the scene file and line; the CLI could print only it.
- **Reflections for metals.** A file's material more metallic than 0.6 without a metallic texture
  is refused, because the stage has no environment map: checked on the demo (2026-11-25), the
  tray at metalness 1 shows near black, at 0.6 dimmer but clear. An environment map made per
  scene for the file's own materials (three's `RoomEnvironment` through `PMREMGenerator`, freed
  with the scene, which the GPU check would watch) would let metals look like metal, so the limit
  could go. It changes how those models look, costs a cube render target per scene, and doesn't
  follow the theme. A metallic texture's pixels aren't read today: such a part shows dark where
  its texture says fully metallic.
- **The panel decodes the images in its check.** The build runs in Node, which can't decode an
  image, so it reads each image's type and size from its header. An image broken past its header
  passes the build and the panel's check, and fails only when the deck loads it: the model is
  left out and the console says why, so `lysark check` (course CI) fails, but the panel shows only
  an empty node. The panel runs in a browser and could decode each image in its check and name a
  broken one under "Models not shown:", at the cost of the panel catching what the build can't.
- **A near-white file colour in print.** The `white` preset is greyer in the print theme so it
  shows on the white page; a file's own white isn't. The print build could darken near-white file
  colours a little (changing the file's look), or the build could warn about them.
- **One parse per file**, again (from step 8): with textures, two objects showing one file hold
  its textures twice on the GPU too.
