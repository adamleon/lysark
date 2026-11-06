# Scene files

How to give a lecture its own named camera views (from engine v2.5.0) and robot poses (from
v2.7.0), and to pose the robot in the editor (from v2.8.0): steps 2 to 5 of
[scene-files-proposal.md](scene-files-proposal.md). Written for the author; no engine knowledge
needed. Objects come in a later step.

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
  with only `base: agilus` is exactly the engine scene.
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
- **View and pose names** can be any word, Norwegian letters included. Comments (`#`) are fine
  anywhere, and the editor keeps them.
- **The file's name** is lower-case letters, digits and dashes, starting with a letter, and ends in
  `.yaml` or `.yml` (`agilus.yaml`, `robot-celle.yaml`): it is the name slides use in `scene:`, and
  the editor can save only into such files. The build says so, with a name to use, for any other.
- `.yml` works as well as `.yaml`, but one scene can have only one file.
- **Values are written out in each view.** YAML's shortcuts for sharing values (`*name`, `<<:`)
  aren't allowed: saving one view must change only that view. (A bare `&name` shares nothing and is
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
across, as within one scene.

## Saving views in the editor

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
- `scenes/agilus.yaml, line 2: unknown key 'objects'. A scene file has 'base', 'views' and 'poses'`

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

P is built the same way. The joint sliders (`src/editor/joint-panel.ts`) set the robot's joints in
the running deck. P works out which joints moved, and where the slide's joints come from (its own
block, or a pose it names), and computes the edit (`src/editor/pose-edit.ts`, only those numbers
changed). New text that changes only cameras and joints goes into the running deck without
loading the panel afresh (`src/editor/editor-compile.ts`, `updateTargets`); the slide shown may
only change to the view or pose just saved from it.

## Not yet

- Shift+P, "Save pose as…" (only this slide, an existing pose, or a new one), step 5b; posing the
  robot by dragging its tool (inverse kinematics), step 5c.
- Objects (tables, workpieces, frames), steps 6 and 7; models from `assets/`, steps 8 and 9.
