# Scene files

How to give a lecture its own named camera views (from engine v2.5.0) and robot poses (from
v2.7.0), to pose the robot in the editor (from v2.8.0; Save pose as… from v2.9.0, dragging
the tool from v2.10.0), to add objects to a scene (from v2.11.0), to move them in the editor
(from v2.12.0) and to add models from STL and GLB files (from v2.13.0): steps 2 to 8 of
[scene-files-proposal.md](scene-files-proposal.md). Written for the author; no engine knowledge
needed.

## In short

A lecture can have a file `scenes/<name>.yaml` next to its `slides.md`. It says which of the
engine's scenes it builds on, and gives camera views and robot poses names. A slide then writes
the name where it wrote numbers before:

```markdown
---
scene: agilus
camera: nært
joints: konfigurasjon
trajectory:
  control: slider
  from: q0
  to: qf
---
```

The build turns each name into its numbers, so the student file holds numbers only. A view
becomes the whole camera, as if the slide had written it (spring included: a view without one
flies with the default); a pose becomes the joints it sets. Every slide that names a view or a
pose gets the same numbers, and changing them in one place changes them on all of them.

## The file

`lectures/baneplanlegging/scenes/agilus.yaml`:

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
  verktøy:                   # follows the tool as it moves
    lookAt: tool0
    offset: [0.4, 0.2, 0.5]

poses:                       # q in radians
  konfigurasjon: [0.3, -0.6, 0.9, 0.0, 0.9, 0.0]   # every joint, in order: joint_1 … joint_6
  q0: [-1.5, -0.5, 1.3, 0.0, 0.7, 0.0]
  qf: [ 1.5, -1.6, 0.4, 0.0, 1.3, 0.0]
  vri: { joint_4: 1.2, joint_6: -0.8 }             # only these two joints
```

- **`base`** (required): the engine scene, one of `arm`, `pendulum`, `agilus`, `agilus-duo`. A file
  with only `base: agilus` is exactly the engine scene, but for the objects another of the
  lecture's files with that base may add (see [Objects](#objects)).
- **`views`**: names, each a whole camera:
  - `lookAt`: the point the camera looks at, `[x, y, z]`, or the name of an anchor of the scene
    (such as `tool0`), which the camera then follows.
  - `offset`: where the camera is, `[x, y, z]` from that point. (`distance` isn't allowed in a
    view: a view must look the same from whichever slide flies to it.)
  - `spring` (optional): how the camera flies there, `{ omega, zeta }`. Without it, the default
    (omega 4, zeta 1).
- **`poses`** (from v2.7.0): names, each a robot pose in radians, written one of two ways:
  - **a list**, every joint of the robot in order (`[q1, q2, …]`), like the q vector in the lecture;
  - **a mapping** of some joints (`{ joint_4: 1.2 }`), which sets only those.

  The build checks each value against the robot's joint limits, and a list's length against the
  number of joints, and says which line is wrong. The joints, in order:

  | Scene | Joints |
  | --- | --- |
  | `arm` | joint1, joint2, joint3 |
  | `pendulum` | swing |
  | `agilus`, `agilus-duo` | joint_1, joint_2, joint_3, joint_4, joint_5, joint_6 |
- **`objects`** (from v2.11.0): boxes, cylinders, spheres, coordinate frames and invisible points
  in the scene; see [Objects](#objects). From v2.13.0 also models from STL and GLB files; see
  [Models](#models).
- **View and pose names** can be any word, Norwegian letters included. Comments (`#`) are fine
  anywhere, and the editor keeps them.
- **The file's name** is lower-case letters, digits and dashes, starting with a letter, and ends in
  `.yaml` or `.yml` (`agilus.yaml`, `robot-celle.yaml`): it is the name slides use in `scene:`, and
  the editor can save only into such files. The build says so, with a name to use, for any other.
- `.yml` works as well as `.yaml`, but one scene can have only one file.
- **Values are written out in each view, pose and object.** YAML's shortcuts for sharing values
  (`*name`, `<<:`) aren't allowed: saving one view must change only that view. (A bare `&name` shares nothing and is
  kept as written.)

## Using a view in a slide

- **`camera: <name>`** on a slide uses that view. The slide must say `scene:` too, and the view is
  looked up in the file for that scene.
- **A named view is the whole camera.** It replaces what earlier slides set, spring included: a
  view without `spring` flies with the default, even if an earlier slide set another spring.
- **Later slides carry it on**, as numbers do today: a slide without `camera:` keeps the view.
- **A `camera:` block on a later slide** changes only what it lists, on top of the view, as it
  always has.
- **A slide has a name or a block, never both.** So V always knows where to write.
- **Numbers stay allowed everywhere.** A lecture without scene files works as before.

## Using a pose in a slide

- **`joints: <name>`** on a slide sets the joints the pose names, as a `joints:` block does: a
  list sets them all, a mapping only its own. Later slides carry them on, as always.
- **`from: <name>`** and **`to: <name>`** in a `trajectory:` take a pose as either end. Both ends
  must set the same joints, as before: two list poses always do.
- As for views, the pose is looked up in the scene file for the slide's `scene:`, and a slide
  writes a name or numbers, never both in one place.
- Inline numbers aren't checked against the limits (an out-of-range value is held at the limit
  when the robot moves, as before); only poses are.

## Which scene

`scene: X` uses the lecture's `scenes/X.yaml` if there is one, and otherwise the engine scene `X`.
The file's name is the name slides use, and its `base` is the scene that runs. So
`scenes/celle.yaml` with `base: agilus` lets slides say `scene: celle` and get the KUKA with that
file's views. Usually the file is simply named after its base, as `scenes/agilus.yaml` is.
Scene files with the same base are the same running scene: slides with `scene: celle-a` and then
`scene: celle-b`, both built on `agilus`, are one run of the KUKA, and joints and camera carry
across, as within one scene. So do slides that name the engine scene `agilus` itself: the
objects of whichever of the lecture's files built on `agilus` has them are on all of them.

## Objects

From engine v2.11.0. A scene file can add simple things to its scene under `objects:`: tables,
workpieces, coordinate frames, and invisible points to look at or label. From the demo lecture's
`scenes/arm.yaml`:

```yaml
objects:                     # in metres and degrees; y is up, as in camera:
  table:
    box: [0.4, 0.3, 0.4]     # width, height, depth
    at: [0.62, 0, -0.69]     # the middle of its underside: on the floor
    rotate: 48               # degrees about the vertical
    material: wood
  part:                      # on the table: at is in the table's frame
    cylinder: [0.07, 0.1]    # diameter, height
    at: [0, 0.3, 0]
    parent: table
    material: blue
  grip:                      # no shape: an invisible point, on top of the part
    at: [0, 0.1, 0]
    parent: part
  base frame:
    frame: 0.3               # the length of its axes
    parent: base             # the robot's base frame: z is up
  tool frame:
    frame: 0.1
    parent: end_effector     # moves with the arm
```

Here, as in `camera:`, y is up and x and z run along the floor. That holds for an object in the
scene itself. An object on another object takes that object's frame, turned as it is, and one on
a robot's anchor takes the robot's own frame (see `parent` below).

- **A shape**, one per object, its size in metres:
  - `box: [width, height, depth]`, along x, y and z;
  - `cylinder: [diameter, height]`, its height along y, so it stands upright;
  - `sphere: diameter`;
  - `frame: length`: a coordinate frame, its axes arrows that long, x red, y green, z blue;
  - `model: path`: a part from a file, its size the file's (from v2.13.0; see [Models](#models));
  - no shape: an invisible point. Nothing is drawn; it is there to look at and to label.
- **`at`**: where it is, `[x, y, z]` in metres. For a box, cylinder, sphere or model it is the
  middle of its underside, so a y of 0 stands it on the floor; for a frame, its origin; for a
  point, the point. Without `at`, `[0, 0, 0]`.
- **`rotate`**: a number turns the object about y, the vertical, in degrees (`rotate: 40`).
  `[x, y, z]` turns it about x, then about y, then about z, each axis as the turn before left it:
  `rotate: [90, 0, 0]` lays a cylinder on its side along z, and `[0, 30, 90]` lays it along x
  turned 30 degrees about the vertical. It turns about `at`, so an object laid on its side needs
  `at` raised by half its thickness to rest on the floor. Without `rotate`, none.
- **`material`**: the colour of a box, cylinder, sphere or model: `grey` (without one), `white`,
  `black`, `red`, `yellow`, `green`, `blue`, `wood` or `metal`. They follow the theme: in the
  PDF, `white` is a little greyer, so it shows on the white page, and a frame's axes are darker.
  A frame has its axis colours, and a point none.
- **`parent`**: another object in the file, or one of the scene's anchors below. The object then
  sits on its parent and moves with it, and `at` and `rotate` are in the parent's frame. An
  object's own frame has its origin at its `at`, turned by its `rotate`, y up as built: `at: [0,
  0.3, 0]` on a table 0.3 high stands an object on the table. A robot's anchors have the robot's
  own frames, as robotics draws them: `base` has z up, and `tool0` and `end_effector` have z
  pointing out of the tool. So a frame on one of them shows the robot's own axes. A shape, though,
  is built along its parent's y, and a number in `rotate` turns it about that y: on `base` the
  shape would lie along the floor, and on the tool it would point sideways. `rotate: [90, 0, 0]`
  turns its height onto the anchor's z, so it stands up on `base` and points out of the tool, and
  `[90, a, 0]` then turns it `a` degrees about that z (about the vertical on `base`, about the
  tool's axis on the tool):

  ```yaml
    gripper:
      box: [0.04, 0.06, 0.04]
      parent: end_effector
      rotate: [90, 0, 0]       # its height along the tool's z, out of the tool
  ```

  | Scene | Its anchors | Anchors an object can hang on |
  | --- | --- | --- |
  | `arm` | `base`, `end_effector` | both |
  | `pendulum` | `pivot`, `bob` | both |
  | `agilus` | `base`, `tool0` | both |
  | `agilus-duo` | `base`, `tool0` (robot 0's) | none: a slide can draw either robot as the ghost, and an object on it would turn ghost too |
- **Names** are a word or two, as for views. Each object is an anchor of the scene by its name,
  as the scene's own anchors in the table above are: `lookAt: grip` in a slide's `camera:` or a
  named view, and `anchored:` with `anchor: grip`. A name can't be one of the scene's own anchors,
  nor a word JavaScript keeps for itself (`constructor`, `toString`, …).
- **Every slide of the scene shows them**, from its first slide to its last: objects are part of
  the scene and don't come and go per slide. Scene files with the same base are one running
  scene (see [Which scene](#which-scene)), so only one of them can have objects, and they are
  on every slide of that scene's run, slides that name the engine scene included.
- **In the editor**, M moves objects by dragging them (from v2.12.0: see
  [Moving objects in the editor](#moving-objects-in-the-editor)). A new `at` or `rotate` for an
  object of the scene on screen, dragged or typed, goes into the panel at once. Anything else
  loads the panel afresh, a moment: a new place typed for an object of another scene (or on a
  slide without a scene), or for the object the slide on screen looks at (so the camera flies
  to it), and any other change to an object (its shape, size, material or parent, a model's
  file, `unit` or `up`, or an object added, removed or renamed).

## Models

From engine v2.13.0. An object can show a part from a file instead of a shape: an STL exported
from a CAD program, or a GLB from Blender. From the demo lecture's `scenes/arm.yaml`:

```yaml
  bracket:                   # an STL from a CAD program: in millimetres, z up
    model: models/bracket.stl
    unit: mm
    up: z
    at: [0.1, 0.3, 0.1]      # the middle of its underside, on the table's top
    rotate: 180
    parent: table
    material: metal
  tray:                      # a GLB from Blender: in metres and y up, as glTF is
    model: models/tray.glb
    at: [-0.1, 0.3, -0.1]
    parent: table
```

- **`model`** is a shape, written where a box writes `box:`, one per object. Everything in
  [Objects](#objects) holds for it: `at`, `rotate`, `material`, `parent`, its name as an anchor,
  and M in the editor.
- **The path** is from the lecture folder, where `slides.md` is, as for images, even though the
  scene file is in `scenes/`: `models/bracket.stl` for a file in the lecture folder,
  `../../assets/bracket.stl` for one in the course's `assets/` folder, which several lectures can
  share. The file must be in one of the two, in any folder with a plain name (below). Write it
  with `/`, and it is read as written, so `%20` stays `%20`.
- **Letter case** must match the names on disk exactly, all along the path, because the course
  is built on Linux: each folder and the file, a folder the path comes back into after `..`
  (`../Demo/models/` from the lecture folder `demo` is wrong), and the course's folder itself,
  which must be named `assets`. This holds for images too.
- **Names VS Code's panel can't read** are refused, so the panel and the build agree: a folder
  or file whose name starts with `.` (`models/.export/`), has `~` and a digit (`bracket~1.stl`,
  like a Windows short name) or has a `:`, and a file reached through a link (a symbolic link or
  a junction). Rename the folder or file, or copy the file into place. Plain names are fine:
  letters, digits, spaces, `-`, `_` and dots inside a name (`bracket.v2.stl`).
- **The file** is `.stl` (binary or text) or `.glb` (binary glTF), in any letter case (`.STL`
  works, written as on disk). Export anything else from the CAD program as STL, binary rather
  than text (about five times smaller), and glTF as binary glTF, `.glb`.
- **`unit`**: what the file is measured in, `mm`, `cm` or `m`; without it, `m`. An STL says
  nothing about its unit, and CAD programs usually write millimetres: write `unit: mm`. ROS
  meshes are in metres, and glTF always is.
- **`up`**: the axis that is up in the file, `y` or `z`; without it, `y`, as in glTF (Blender's
  export turns its z up into y). ROS meshes and many CAD programs have z up: write `up: z` for
  those. If a part lies on its side, change `up`. `unit` and `up` are only for models: a shape is
  built in metres with y up.
- **Where it stands:** `at` is the middle of the underside of the model's bounding box (the
  smallest box along x, y and z around it), measured after `unit` and `up` and before `rotate`. So a
  y of 0 stands it on the floor, as for a box, and `rotate` turns it about `at`. The file's own
  origin is not used: a part drawn around a hole, or from a corner (as the demo's tray is), still
  stands on `at`. An object hung on a model is in the model object's frame, as on a box: its
  origin at the model's `at`, y up whatever `up` says.
- **On a robot's tool:** a model is built along its parent's y, as a shape is, and the tool's
  anchors have z pointing out of the tool. For a part drawn in CAD with z up out of the flange,
  write `up: z` and `rotate: [90, 0, 0]`: the two turns cancel, and the file's x, y and z are the
  anchor's own. The part sits with its lowest z on the flange and its bounding box centred on the
  tool's axis, so one that isn't symmetric about the axis is off it by that much: move it with
  `at`.

  ```yaml
    gripper:
      model: ../../assets/gripper.stl
      unit: mm
      up: z                    # with rotate [90, 0, 0], the file's axes are the tool's
      rotate: [90, 0, 0]
      parent: end_effector
  ```
- **Colour:** `material`, one preset for the whole model, as for a box (`grey` without one), so
  models follow the theme and the print PDF. The file's own colours and materials are not used.
- **Shading:** an STL's own normals are not used either (CAD programs write flat ones, or none):
  the shading is worked out from the triangles, smooth across edges under 40 degrees and sharp
  above, as for the KUKA, whatever the unit. The same goes for a GLB mesh without normals.
- **Size:** a file may be at most 5 MB (5,000,000 bytes on disk), about 100,000 triangles as
  binary STL. For a larger part, export it with fewer triangles (CAD programs have a coarser STL
  setting) or as binary STL. The model's largest side, read in its `unit`, must be between 1 mm
  and 10 m: anything else is a file read in the wrong unit, and the build says what to change.
  Each file is built into the student file once, about a third larger than on disk, however
  many objects show it. A lecture without models carries none of the code that reads them.
- **Refused**, each with a message that says what to do (see
  [When something is wrong](#when-something-is-wrong)): a GLB with textures or images (textured
  models are step 9), a `.gltf` or a GLB that keeps its data in another file, a compressed GLB
  (Draco, meshopt), one with bones (a skin) or GPU instancing, one that needs a glTF extension
  lysark doesn't read, a file that isn't the STL or binary glTF 2.0 its name says, or has no
  triangles, and a Git LFS pointer in place of the file (course CI doesn't fetch LFS files: keep
  models in git itself).
- **Left out without a word:** a GLB's lights and cameras (the scene's own lights stay the only
  ones), its animations, its lines and points, and its materials, vertex colours and texture
  coordinates; an STL's colours. Meshes the file hangs under a light, camera, line or points stay,
  where the file put them.
- **In `lysark dev`**, changing a model file reloads the preview, as an image does.
- **In the editor**, the panel reads the model files through VS Code once the images have come,
  checks them as the build does, and shows the models. M puts each model's ring at its middle, and
  a new `at` or `rotate`, dragged or typed, goes in as for any object. Any other change to a
  model object (its `model`, `unit`, `up`, `material` or `parent`) loads the panel afresh, which
  reads the file again. Creating, deleting or renaming a model file in VS Code loads it afresh
  too, but a file overwritten in place (a new export from the CAD program, a `git pull`)
  doesn't: press ▷ (Open Lysark Preview) in the editor's title bar, as for an image.

  A model the panel can't show (a file that isn't there, too large, or refused) is drawn as an
  empty node, still an anchor and a parent, and a banner lists each under **Models not shown:**
  (after **Images not shown:**, if any), with the scene file, the line, the object and the build's
  words. Letter case is the exception, as for images: desktop VS Code on Windows finds
  `Bracket.stl` for `bracket.stl`, so the panel shows a model only the build refuses. A path
  whose case is wrong in a folder after `..` (`../../Assets/bracket.stl`) the panel calls outside
  the lecture folder, on any computer, and the build says the case is wrong.

## Saving views in the editor

The panel hears its keys (V, J, P, M) only after a click in it. It follows the cursor in
`slides.md`, but keys typed while the cursor is there go into the text.

- **V on a slide that names a view** (or the camera button, or Scene Actions…) changes that view in
  the scene file. The panel says which slides now fly to it, those that carry it on included. The
  hint at the top of the panel says where V will write, and which slides fly to that view, before
  you press it.
- **V on a slide with its own `camera:` block, or none,** writes into the slide, as before.
- **Shift+V, "Save view as…"** (from engine v2.6.0) opens a small list in the panel. ↑ and ↓ choose,
  Enter saves, Esc closes:
  - **Only this slide:** the slide gets a `camera:` block of its own (`lookAt` and `offset`) in
    place of the name it had. Slides after it without a `camera:` of their own carry the block on,
    so they move with it. The view's spring isn't copied: the block flies with the spring carried
    from earlier slides, or the default.
  - **The view 'X'**, for each view in the scene file, with the slides that fly to it: the camera
    goes into that view, and the slide says `camera: X` from now on. Every slide that uses X
    changes with it. The slide then flies as the view does (its spring, or the default); a spring
    the slide had of its own goes with its old `camera:` block.
  - **A new view:** type its name: one word of letters (æ, ø and å too), digits, - and _, starting
    with a letter, and not a word YAML reads as a value (true, false, null, yes, no, on, off, y, n).
    It goes into the scene file, with the slide's spring if it had one (so it flies as before),
    and the slide says `camera: <name>`. If the lecture has no scene file for the slide's scene
    yet, it makes one, `scenes/<scene>.yaml`, with `base:` set.

  Scene Actions… (the list button on the panel's title bar) offers the same, in VS Code's list.
- The change is an ordinary unsaved change, usually in a scene file with no editor open on it: the
  panel says "not saved yet". Save it (File > Save All; github.dev saves by itself after a moment),
  and it shows in Source Control. A new scene file is written at once; the slide's `camera:` line
  in slides.md is then the unsaved part.
- **Ctrl+Z** in the file undoes it. A Save view as… that changed slides.md and a scene file, or made
  a new one, is undone in both with one Ctrl+Z in slides.md, the new file included.
- Saving a scene file with Ctrl+S, or creating or deleting one in VS Code, updates the panel.

## Posing the robot in the editor

From engine v2.8.0.

- **J** opens the joint sliders at the top right of the panel: one per joint of the slide's
  robot, between its limits, in radians (and degrees). A slider moves its joint at once, as a
  teach pendant jogs it, whatever gains the slide teaches with; a slider of the slide's own for
  that joint follows. J again, or ×, closes them. In `agilus-duo` they move robot 0 (`joint_1` …
  `joint_6`), the one a trajectory's `profile` drives; the other robot (`ghost_joint_*`) isn't
  posed here.
- **Dragging the tool** (from engine v2.10.0): while the sliders are open, a ring sits on the
  robot's tool (in `arm` and `agilus`). Drag it, and the tool follows the pointer in the plane
  that faces you; the joints follow by inverse kinematics, each step turning them as little as it
  can from where they are, within their limits, so the wrist may turn too. The elbow stays bent
  the way it is: past the edge of reach the tool stops at the edge, the elbow a little short of
  straight, and slides along the edge as the pointer moves on. To bend the elbow the other way,
  use its slider. A joint that reaches its stop stays there while the others take the tool on, and
  the joints the tool doesn't need (the KUKA's wrist) lean back to the pose before you began
  dragging (the pose you last set with a slider or saved, or the slide's), so dragging out and
  back, in one drag or several, comes back to it. From an elbow held nearly straight, pulling the
  KUKA's tool in can fold its wrist instead of bending the elbow; bend the elbow with its slider
  first. Drawn over the top of the base,
  close to its axis, the arm can swing the base half a turn and come back the other way round, or
  stop short where the base reaches its stop, and right above the base the tool may not follow
  sideways; turn the base with its slider instead. To move the tool nearer or farther, turn the view and drag again. Pressing the
  ring stops a camera flight where it is. Only the joints the drag turned are marked (never the
  KUKA's `joint_6`, whose axis runs through the tool), and P or Shift+P saves them, as for the
  sliders. `agilus-duo` and `pendulum` have no ring.
- **P** (or Scene Actions…) saves the pose: the joints marked in the sliders (their names in the
  accent colour), to two decimals, each inside its limits. Like V, it writes where the slide's
  joints come from:
  - **a slide that names a pose** (`joints: reach`): into that pose in the scene file. A list pose
    stays a list, its numbers replaced where they stand; a mapping pose gets the joints, added if
    it didn't have them. Afterwards the panel says which slides changed with it, those that carry
    it on included.
  - **a slide with its own `joints:` block**: into the block. Joints it has change where they
    stand; others are added after them.
  - **a slide without `joints:`**: a block with the marked joints.

  The line under the sliders says where P will write before you press it, and which slides use
  that pose now.
- **Shift+P, "Save pose as…"** (from engine v2.9.0) opens the same kind of list as Shift+V (↑ and ↓
  choose, Enter saves, Esc closes; Scene Actions… offers the same). The slide keeps the pose it
  shows, whichever you choose:
  - **Only this slide:** a slide that names a pose gets a `joints:` block of its own in place of
    the name: the pose's joints, and the ones you moved. On a slide with a block, or none, it is
    what P does.
  - **The pose 'X'**, for each pose in the scene file, with the slides that use it: the slide says
    `joints: X` from now on, and X takes the robot's pose. A list pose gets every joint; a mapping
    pose its own joints, the joints the slide set itself, and the ones you moved. Every slide that
    uses X changes with it.
  - **A new pose:** type its name (one word, as for a new view). It goes into the scene file as a
    list of every joint, in order, and the slide says `joints: <name>`. If the lecture has no
    scene file for the slide's scene yet, it makes one, `scenes/<scene>.yaml`, with `base:` set.

  A joint you moved is written to two decimals, inside its limits. One you didn't keeps the value
  the slide gives it (or the scene's), or the limit if that value is outside it. A joint that
  neither the slide nor the scene sets is written where the robot holds it, to two decimals (after
  an `idle:` slide, wherever the idle left it). The panel then says which other slides change with
  the save.

  A save that would leave the slides with an error is refused, and the panel says why. For
  example, joints can't be added to a mapping pose that is one end of a trajectory, since both ends
  must set the same joints: choose a list pose or a new pose there. A slide that sets joints a pose
  of its scene can't hold (in `agilus-duo`, the other robot's `ghost_joint_*`) can only be saved
  into the slide itself (P, or "Only this slide").
- **Which joints are marked:** a joint away from where the slide puts it (its own joints, carried
  ones, a pose, or the scene's), and a joint you moved with the sliders that no slide puts
  anywhere. The robot keeps such a joint where you left it on the next slides too, until a slide
  puts it somewhere, so it stays marked there, and P there writes it as well. A joint you didn't
  touch keeps coming from where it did. A slide's own slider can move a joint too; it is marked if
  the slide puts that joint somewhere.
- **A slide whose robot moves by itself** (a `trajectory:`, or `idle:`) can't be posed: the sliders
  are off there, and P saves nothing.
- As with views, the change is unsaved until you save it (File > Save All), Ctrl+Z in the file
  undoes it, and the panel shows it without loading afresh, a trajectory that starts or ends in
  the pose included. P saves one pose at a time: pressed again before the last one is back in the
  text (a moment), it says so.

## Moving objects in the editor

From engine v2.12.0.

- **M** shows a ring on each object of the slide's scene, with its name, and a list at the top
  right of the objects and where each is (`at` and `rotate`). M again, or ×, hides them. M and J
  take turns: opening one closes the other. The hint at the top of the panel offers M where the
  slide's scene has objects.
- **Drag a ring** to move its object along the floor: it keeps its height. Hold **Shift** while
  dragging to move it up and down instead (not when looking from straight above: look from
  lower down for that). A press that goes no farther than a few pixels is a click, and moves
  nothing. The ring sits in the middle of a shape (on a frame or a
  point, at its origin), and the object follows the pointer from where you pressed it. Seen from
  about the ring's height, the floor is edge-on: the object then moves only sideways; look from
  higher up to move it nearer or farther. What is written is `at` in the object's parent's frame
  (see `parent` above): for an object standing in the scene, along the floor changes x and z; on
  a robot's base, whose z is up, x and y. An object on a robot's tool moves with the tool, and a
  drag goes from where the tool was when you pressed the ring.
- **Drag the dot** beside a ring around the ring to turn the object about the vertical. A sweep
  the clock's way on screen, seen from above, turns it the clock's way, and once round on screen
  is once round. At rest the dot shows which way the object faces: its own x along the floor,
  or, if x points more up or down than along the floor, the flatter of its z and y. While you
  turn, it stays under the pointer. An invisible point has no dot, unless another object hangs on
  it (which turns with it).
- The object moves at once, to the centimetre and the whole degree, as the file will have it.
  **Letting go writes** into the scene file with the scene's objects what the drag changed, `at`
  for a move and `rotate` for a turn: only the numbers that changed, each where it stands;
  comments and everything else stay as they were. If the scene file has the object elsewhere
  than the panel shows (typing the panel hasn't had yet: the panel updates on Ctrl+S), the move
  is refused, and the panel says to save the file first. `rotate: 48` stays a number while the object turns only about its parent's y (an object
  standing in the scene does), and becomes `[x, y, z]` when it doesn't: on a robot's base,
  turning changes the angle about z (a frame there turned 30 degrees is `rotate: [0, 0, 30]`).
  An `at` or `rotate` the object didn't have is added after its other keys. An angle the turn
  changed is written between -180 and 180: `rotate: 170` turned 20 degrees is `-170`.
- **Esc** while dragging puts the object back, and nothing is written. Dragged farther than a
  scene file allows (10 m), the object stops at the last place it could go.
- As with views and poses, the change is unsaved until you save it (File > Save All), Ctrl+Z in
  the scene file undoes it, and the panel shows it without loading afresh. Pressing a ring stops
  a camera flight where it is, as a click in the scene does, and stops the view coasting after
  you turned it; the view then stays put while you drag, even on a slide that looks at the
  object. Moves are written one after another, and while one is on its way into the file the
  object stays where you put it. V or P pressed meanwhile waits for it, and saves nothing if you
  went to another slide in the meantime (and back, too).
- A move that can't be written is refused, the object goes back, and the panel says why: for
  example a move of an object whose `at` is written with a YAML anchor or tag (`&p`, `!!float`),
  which the panel won't write over (a turn leaves such an `at` alone). Change such a place by
  hand.

## When something is wrong

The build (and the panel) names the file, the line and what to do. For example:

- `slides.md, line 12: slide 4 names the camera view 'oversikt', but the lecture has no
  scenes/agilus.yaml to find it in.` The message shows what to put in the new file.
- `slides.md, line 12: slide 4 names the camera view 'verktoy', which scenes/agilus.yaml doesn't
  have. Did you mean 'verktøy'? Its views: tittel, nært, verktøy.`
- A misspelled `scene:`: `slides.md, line 12: slide 4 names the camera view 'oversikt' in scene
  'agilsu', which is neither one of the lecture's scene files nor an engine scene. Did you mean
  'agilus'?`
- `scenes/agilus.yaml, line 7: view 'nært' has no offset: where the camera is, [x, y, z] from the
  point it looks at`
- `scenes/agilus.yaml, line 17: pose 'q0' sets joint_2 to 1.2, outside its limits, -3.316 to
  0.785 (radians)` (limits are shown to three decimals, rounded inward)
- `scenes/agilus.yaml, line 18: pose 'qf' lists 5 values, but 'agilus' has 6 joints: joint_1,
  joint_2, joint_3, joint_4, joint_5, joint_6`
- `slides.md, line 30: slide 8 names the pose 'q1', which scenes/agilus.yaml doesn't have. Did you
  mean 'q0'? Its poses: konfigurasjon, q0, qf, vri.`
- `slides.md, line 14: slide 5 trajectory 'from' (the pose 'q0') sets joint_1, joint_2, joint_3,
  joint_4, joint_5, joint_6, but 'to' (the pose 'vri') sets joint_4, joint_6. Both ends must set
  the same joints: two list poses always do.`
- `scenes/arm.yaml, line 21: object 'table' box has 400, which is 400 m: sizes and places are in
  metres (400 mm is 0.4)`
- `scenes/arm.yaml, line 28: object 'part' has the parent 'tabel', which is neither an object in
  this file nor an anchor of 'arm'. Did you mean 'table'? The parent is another object in this
  file, or an anchor of 'arm' (base, end_effector)`
- `scenes/agilus.yaml, line 2: unknown key 'object'. Did you mean 'objects'? A scene file has
  'base', 'views', 'poses' and 'objects'`

For models, what the text alone shows is a compile error, as above (the panel keeps showing the
last good version), and the build fails on anything about the file itself. The panel then draws
the object without its model and lists the message under "Models not shown:", in the build's
words (for a file VS Code won't read, its own reason). For example:

- `scenes/arm.yaml, line 41: object 'bracket' model 'bracket.step' isn't a file a lecture can
  show: export it from the CAD program as .stl (binary) or .glb`
- `scenes/arm.yaml, line 42: object 'bracket' unit 'millimetre' isn't one of mm, cm or m: what the
  file is measured in (without unit, m). Did you mean 'mm'?`
- `scenes/arm.yaml, line 42: object 'bracket' has 'scale': a shape's size is written with it (box:
  [0.4, 0.2, 0.4]), and a model's comes from its file: give unit: mm for a file measured in
  millimetres`
- `scenes/arm.yaml, line 43: object 'bracket' up must be the axis that is up in the file, y or z;
  without up, y; ROS meshes and many CAD programs have z up`
- `scenes/arm.yaml, line 41: object 'bracket' model 'models/.export/bracket.stl' has a folder name
  starting with '.' ('.export'), which VS Code's panel won't read: rename the folder` (`file
  name` and `rename the file` for the file's own name). A name with `~` and a digit gets `has a
  file name with ~ and a digit ('bracket~1.stl'), like a Windows short name, which VS Code's
  panel won't read: rename the file`, and one with a `:` gets `has a folder name with a colon
  ('v2:final'), which VS Code's panel won't read: rename the folder`.
- `scenes/arm.yaml, line 41: object 'bracket': the model 'models/cad/bracket.stl' goes through a
  link ('models/cad'), which VS Code's panel won't read: copy the file into place` (the panel
  itself names such a file outside the lecture folder)
- `scenes/arm.yaml, line 41: object 'bracket': the model '../Demo/models/bracket.stl' has the
  wrong capital letters: on disk the name is 'demo'. Letter case must match, because the course
  is built on Linux. Fix the path in the scene file, or rename 'demo' with git mv (renaming only
  the case in Explorer is invisible to git)` (in any folder of the path, or the file's name)
- `scenes/arm.yaml, line 41: object 'bracket': the model '../../assets/bracket.stl' is in the
  course's assets folder, which on disk is named 'Assets'. It must be named 'assets', because the
  course is built on Linux. Rename the folder with git mv (renaming only the case in Explorer is
  invisible to git)` (an image there gets the same, as `the image`)
- `scenes/arm.yaml, line 41: object 'bracket': the model '../models/bracket.stl' is outside the
  lecture folder. Write models/bracket.stl: the path is from the lecture folder, not from
  scenes/` (a path written from `scenes/` gets this hint whenever the file is there read that way)
- `scenes/arm.yaml, line 41: object 'bracket': the model is 80 m across, read in m. Is the file in
  millimetres? Write unit: mm` (and the other way round: `the model is 0.16 mm across, read in
  mm. Is the file in metres? Leave out unit`)
- `scenes/arm.yaml, line 49: object 'tray': the model has textures, which come in a later step.
  Its colour comes from material: anyway, so export it without materials or textures (or as
  STL)`
- `scenes/arm.yaml, line 41: object 'bracket': the model is 7.3 MB; a model may be at most 5 MB.
  Export it with fewer triangles, or as binary STL rather than text STL (about five times
  smaller)`
- `scenes/arm.yaml, line 49: object 'tray': the model is a Git LFS pointer, not the model: the
  course build doesn't fetch LFS files. Keep the file in git itself (git lfs untrack, then commit
  it again)`

When several objects show one file in different units, the message names the first object whose
unit is wrong, at its own line.

**Slide keys are checked too** (from v2.5.0). A misspelled key used to be ignored without a word;
now `camrea:` stops the build: `slides.md, line 9: slide 3 has the key 'camrea', which a slide
doesn't have. Did you mean 'camera'?` A slide's keys are `id`, `scene`, `layout`, `joints`,
`camera`, `widgets`, `anchored`, `idle` and `trajectory`. Both existing lectures use only these.

## How it works

The compiler gets the text of the lecture's scene files from whoever calls it (the build reads
`scenes/*.yaml`; in the panel, the VS Code extension sends them with `slides.md`), since it never
reads files itself. It checks them (`src/compiler/scene-files.ts`), and where a slide names a view
it puts the view's numbers into the slide (`src/compiler/compile-slides.ts`). A pose works the
same way: where a slide says `joints: <name>`, or a trajectory's `from:` or `to:` names a pose,
the compiler puts in the joints the pose sets, then checks the slide as before. Everything after
that, the slide engine and the student file included, sees numbers only, as before.

To read a list pose and check the limits, the compiler needs each scene's joints in order with
their limits. It can't load the scenes themselves (they bring three.js and the robot models), so
`src/scenes/joints.ts` holds a small table of them. A test (`src/scenes/joints.test.ts`) reads the
URDF files and the pendulum scene's constants and fails if the table disagrees, so a change to a
robot can't leave the table behind. The course
site rebuilds a lecture when anything in its folder changes, scene files included.

In the panel, V works out whether the slide names a view (`src/editor/save-view.ts`). If it does,
it reads the scene file from VS Code, changes only that view's `lookAt` and `offset`
(`src/editor/camera-edit.ts`, everything else byte for byte), and asks the extension to apply the
edit (docs/editor-host.md). No extension update was needed for this: extension 0.3.0 already
sends, reads and edits scene files.

P and Shift+P are built the same way, Shift+P in the same dialog as Shift+V. The joint sliders
(`src/editor/joint-panel.ts`) set the robot's joints in the running deck, and so does the ring at
the tool (`src/editor/tool-handle.ts`), with the scene's inverse kinematics (`src/scene/ik.ts`;
the arm's scene has it from v2.10.0, the KUKA's had it for MoveL). P works out which joints moved, and where the slide's joints come from (its own
block, or a pose it names), and computes the edit (`src/editor/pose-edit.ts`, only those numbers
changed). New text that changes only cameras and joints goes into the running deck without
loading the panel afresh (`src/editor/editor-compile.ts`, `updateTargets`); the slide shown may
only change to the view or pose just saved from it.

M is built the same way. Its rings are drawn over the canvas, as the tool's ring is
(`src/editor/object-handles.ts`). A drag moves the object's three.js object at once, in a plane
through its ring (the floor's, or with Shift the upright one that faces you), worked out in its
parent's frame and rounded as the file will have it. Letting go computes the edit on the scene
file as VS Code has it (`src/editor/object-edit.ts`, only the numbers that changed) and asks the
extension to apply it. New text whose objects differ only in `at` and `rotate`, for objects of
the scene on screen, goes into the running scene: the runtime moves those objects and keeps the
deck's list of objects in step
(`src/editor/runtime.ts`, `placeObjects`). Any other change to the objects still loads the panel
afresh, since the scene manager builds them into a scene only once. No extension update was
needed.

Objects take the same road as views and poses: the compiler checks them
(`src/compiler/scene-files.ts`) and hands them on as data, by the scene they are in, with the
slides (the student file's deck, from `vite-plugin-lecture.ts`; the panel's, from
`src/editor/deck-from-source.ts`). When a scene is first shown, the scene manager adds them to it
(`src/scene/objects.ts`): each a three.js object on its parent, with its colour read from the
theme (`--object-*` and `--frame-*` in `src/styles.css`), and each an anchor of the scene. To
check names and parents, the compiler needs each scene's anchors, and like the joints it can't
load the scenes: `src/scenes/anchors.ts` holds them, and a test checks it against the scenes'
own `anchors:`.

Models take the images' road. The compiler reads no files, so it only checks what the text
shows (the path's form and names, the file type, `unit` and `up`: `src/compiler/model-types.ts`)
and reports each model object's path with its scene file and line, for the scenes some slide
runs. The build (`vite-plugin-slides.ts`, `resolveFile`) finds each file as it finds an image:
it follows the path name by name from the lecture folder, each name as the folder lists it, so
letter case is checked on Windows as on Linux, and for a model it refuses a link on the way.
Then it checks the file (`src/scene/model-check.ts`): its size first, then what its bytes say (a
GLB's list of what it holds is read before anything is parsed), then it parses the file with
three.js's own STL and glTF loaders, the ones the lecture uses, checks what they built for bones
and GPU instancing, and counts and measures it. The glTF loader is given a loading manager that
refuses every address, so a file that asks for another and gets past the checks fails to parse
(`it asks for another file`) rather than fetching anything. The build puts each file into the
slides once, as base64 text, under every path the scene files write for it. Only a lecture with
models gets the code that reads them (`src/scene/models.ts`, with the loaders;
`vite-plugin-lecture.ts`). When a scene is first shown, the scene manager turns each model
object's text back into bytes and parses it in memory, then adds the objects
(`src/scene/objects.ts`): the model on its object, scaled by `unit`, turned for `up`, moved so
that the middle of its underside is the object's origin, and given the preset's material.
Nothing is fetched and nothing runs in a worker, so the student file still works from
`file://`. In the panel, the runtime reads the same paths through VS Code once the images have
come (`src/editor/panel-models.ts`), runs the same check, and hands the files that pass to the
same code; a file that fails is left out and named in the banner. No extension update was
needed: extension 0.3.0 reads files in the lecture folder or `assets/` as bytes, as it reads
images, but no path with a name starting with `.`, a name with `~` and a digit, or a `:`, and no
file through a link (`resolveInside` in `extension/src/logic.ts`, `noLinks` in
`extension/src/extension.ts`). For a model the compiler refuses those names
(`modelPathProblem`) and the build a link, so the build and the panel agree. For an image they
don't yet: it builds, and the panel leaves it out as outside the lecture folder
(scene-files-proposal.md, "Proposals from step 8").

Textures wait for step 9 for two reasons. The scene teardown (`src/scene/dispose.ts`) frees a
scene's geometry and materials but not textures, so a textured model would keep GPU memory after
its scene is put away, and two scenes' worth could be alive at once. And three.js's glTF loader
turns a GLB's images into `blob:` addresses and fetches them, which the student-file check
counts as a request and the released panel doesn't allow. So step 8 refuses textures, and with
them everything else that would need a request, a worker or wasm (a `.gltf`, Draco and meshopt
compression) or GPU memory `dispose.ts` doesn't free (bones, GPU instancing). The rest a GLB can
hold (lights, cameras, lines, points) is taken out before the scene sees it.

## Not yet

- Textured models, step 9 (see [Models](#models) and
  [scene-files-proposal.md](scene-files-proposal.md)).
- Changing an object's size, or turning it about other axes than the vertical, in the panel: type
  those in the scene file.
- Showing, hiding or moving objects per slide, and objects in `agilus-duo` hanging on a robot.
