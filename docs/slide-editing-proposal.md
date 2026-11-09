# Slide editing in the panel: proposals

Not confirmed, and nothing here is scheduled. Written down on 2026-11-09 at the author's request,
after asking how much of PowerPoint the editor panel could do. The answer comes from a review of
the code and of how VS Code's panels (webviews) behave, checked against the code by two reviewers.

The confirmed intent (lysark-v2.md section 8, 2026-10-13) is: no full visual slide editor; slide
text stays text; only the 3D scene gets visual editing. So this note has two priorities:

- **Future proposals** fit that intent. They help with the text without editing slides visually,
  or they finish what the design already asks for.
- **Minimum priority** goes against it: visual editing of slides in the panel. These are built
  only if the author changes the decision, and are listed so their costs are known.

Sizes: **S** is hours, **M** about one scene-file step, **L** two or three steps, **XL** a
project or a format change. **Release** means a new extension version, uploaded to the
Marketplace by hand; extension 0.3.0 was meant to be the last planned one. A release can keep
messages version 3 and announce its new abilities in its messages, so courses whose authors
still have 0.3.0 keep working (raising the version would lock 0.3.0 out until it updates).

## What shapes all of it

- **Every panel action is a text edit** (lysark-v2.md section 5). Without a release the panel can
  only change `slides.md` and `scenes/*.yaml` and create a new `scenes/<name>.yaml`, all as text.
  It can't write image files, delete or rename files, move VS Code's cursor, or undo.
- **A text change reloads the panel** unless it only moves a camera, a pose, a trajectory's ends
  or an object. A reload flashes blank and loses the camera and the reveal step.
- **A click in the panel maps back to a block, not a word.** The Markdown library records line
  ranges for paragraphs, headings, list items and formula blocks only, and rendered math can't be
  turned back into its exact TeX.
- **VS Code takes Ctrl shortcuts first** inside the panel: Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+P and
  Ctrl+F everywhere; Ctrl+B toggles VS Code's side bar and Ctrl+K starts a chord. The panel can
  keep a key with a capture-phase listener, but that relies on undocumented behaviour. Ctrl+Z in
  the panel never reaches `slides.md`.
- **Dropped files** reach the panel only while Shift is held, and drags from the Explorer carry
  only a path.
- **Spellcheck** works in github.dev's panel, not in desktop VS Code's.
- **A Norwegian keyboard** types `$ { } [ ] @` with AltGr, which the browser reports as Ctrl+Alt,
  so shortcut handlers must ignore keys with Alt.
- **Order matters in `slides.md`.** Camera and joints carry forward from slide to slide, and a
  scene can't come back after another scene has run.

## Future proposals

In the recommended order.

1. **Slide text updated in place** (M, engine only). Today any text change reloads the panel.
   When the slides, ids, scenes, cameras, joints and widgets are unchanged, the panel would swap
   the changed text into the running deck and redraw the slide shown at its reveal step: a
   SlideEngine method, with the overview's titles refreshed, and widgets kept when they are
   unchanged. It finishes the design rule "slides are replaced without reloading" (lysark-v2.md
   section 5), and comes before any other text feature. Moving, adding or removing slides would
   still reload.
2. **Click in the panel to jump to the text** (S, release). The panel tells the host a line, and
   the host moves `slides.md`'s cursor there and focuses it. Per slide at first; per block once
   the compiler marks blocks with their lines, as an editor-only option so the student file is
   unchanged (M). It is in the design already ("clicking a slide in the panel moves the cursor
   there") and was never built. Typing stays in VS Code's own editor, with its undo, spellcheck and
   Norwegian input. Of everything here, it gives the most for the least.
3. **Preview as you type** (S, release). The host sends `slides.md` a moment after typing stops,
   not only on Ctrl+S, as the design describes. Only after item 1, or every pause in typing
   flashes the panel.
4. **Undo from the panel** (S). Without a release: Ctrl+Z in the panel writes the inverse of the
   panel's own last edit, as a new edit, refused if the file changed since; it can't remove a
   scene file the panel created. With a release: the host undoes in the file of the panel's last
   edit, if that file still holds what the edit wrote. Either removes a known limit (lysark-v2.md
   section 5).
5. **Focus the panel from the keyboard** (S, release). A "Lysark: Focus Preview" command, so the
   panel's keys work without clicking in it first.
6. **Text editor aids in the course repo** (S, no Lysark code; check each in github.dev first):
   - VS Code's Markdown paste and Shift+drop of images, with `markdown.copyFiles.destination` set
     so they land in `images/`.
   - Workspace snippets for a new slide, a pause, bold and italic.
   - Move Line Up/Down (Alt+↑/↓) on a selected slide to move it.
   - A spell-check extension with a Norwegian dictionary.

   Markdown All in One (Ctrl+B, Ctrl+I, table formatting) runs only in desktop VS Code.
7. **Table styling** (S, engine CSS). Pipe tables already render, but they have no styles. The
   rules would use new theme tokens and be checked in the print PDF.
8. **Plots follow size changes** (S). This is needed before the classroom-shape toggle
   (lysark-v2.md section 7, "Editor panel aids"), and it fixes plots for students who resize the
   window.
9. **Slide links by id** (S, format addition). `[back](#konfigurasjon)` as well as `#3`, so links
   survive slides being moved. Wait until something moves slides or a lecture links by number.
10. **Overflow warning** (S to M, after the classroom shape). The panel measures the slide's
    text against the stage and says in the hint when it runs past the bottom.
11. **Speaker notes** (format addition). A `<!-- notes -->` line splits the rest of the slide off
    as notes. The panel shows them under its hint, and the student file drops them (S). A
    presenter view, with notes, the next slide as text and a timer in a second window, is L. It
    touches the same-bytes decision (section 8), and the classroom PC may block the popup. Notes
    are public, like the repo.

## Minimum priority: visual editing of slides

These would only be built if the author changes the decision. Each would still write ordinary
text into `slides.md`, byte for byte, refusing rather than reformatting. But each is visual
editing of slide text or structure in the panel.

- **Slide sorter** (M to L). Cards come from the panel's own compile; dragging a card moves the
  slide's lines, from its `---` to the next, as one edit.
  - Drops that would bring a scene back after another scene are greyed out.
  - A warning the author can trust lists which slides start or join a run of the same scene,
    where carried camera and joints change. It doesn't diff every value: trajectories override
    most of them. That makes the sorter closer to L.
  - Slides are matched between the text shown and the live file (unsaved typing) the way V does.
  - The panel reloads after each move, even with future item 1.
  - `#n` links and presenting addresses such as `#12` shift.
- **Add, delete, duplicate a slide** (S each). A duplicate needs a fresh id. The panel lands on a
  new slide only if it carries that intent across the reload.
- **Layout picker** (S). Writes `layout:`. First an unknown layout name would become a build error;
  today it silently becomes `panel`.
- **Insert an existing image** from `images/` or the course's `assets/` (S). It goes before the
  slide's first `<!-- pause -->`, or it would appear only at the last step, or after a clicked
  block.
- **Edit a block's Markdown in place** (M). A small text box over the clicked block, with a live
  preview; KaTeX is already in the panel.
  - Formatting buttons and Ctrl+B, Ctrl+I and Ctrl+K inside it (S): text inserted so that undo
    keeps working, and keys with Alt ignored.
  - A table grid editor (M).
  - This duplicates VS Code's editor beside the panel. Future item 2 gives most of its value.
- **Paste or drop an image onto the panel** (M, release). A new host ability to write image files,
  into `images/` only, with a size cap and no overwriting. It needs a security review, since the
  panel runs code from the course site.
- **Drag to resize an image** (M). It rewrites `![]()` as `<img width>`.
- **Typing on the rendered slide, WYSIWYG** (XL). Turning the rendered page back into Markdown:
  - rewraps hand-wrapped lines, so small fixes become large diffs;
  - loses the exact TeX of formulas and escapes such as `\$`;
  - makes hot fixes from a phone harder.
- **Text boxes and shapes placed anywhere** (XL). They need coordinates in the format and a fixed
  stage. Today's layouts are regions laid out by CSS.
- **Per-element fonts, colours and sizes** (L). They bypass the theme tokens and break the print
  PDF.
- **Transitions and per-element animations** (L), beyond `<!-- pause -->`. Students don't care
  about them (lysark-v2.md section 2).
