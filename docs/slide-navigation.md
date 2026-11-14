# Finding your way in slides.md: extension 0.4.0

How the Lysark extension helps you find your way in a lecture's `slides.md` in VS Code. Written
for the author.

The problem (2026-11-12): while scrolling through a lecture's `slides.md` it is hard to tell
which slide you are on and where one slide ends and the next begins, and on each slide the
settings block takes up more room than the text. The author's choice (2026-11-13), after a
prototype in VS Code for the web: the file stays Markdown in VS Code's own Markdown editor, a
plugin for VS Code's Markdown extension keeps the settings out of its outline, the settings
blocks are folded when the file opens, and Lysark adds no slide list of its own.

Built 2026-11-13 as extension 0.4.0, then corrected after a code review and a hands-on test
(2026-11-13 and 14); not yet released. It needs no engine change.

## What you see

All of this is for a lecture's `slides.md`: a file `lectures/<name>/slides.md` in a Lysark
course (a `package.json` above it that depends on lysark, as for the preview), or in the
engine's own repository (its demo lecture). Any other file is left as it is, among them the
course's `README.md` and a `slides.md` that belongs to another slide tool (Slidev's and Marp's
decks are often called `slides.md`, and their slides are separated by bare `---` lines that
Lysark would read as settings).

- **The settings are folded.** The first time a lecture opens in an editor, each slide's
  settings block, from its opening `---` to its closing `---`, is folded to one line that reads
  `--- ⋯`. Click the ⋯ to open one; Go to Line into a block opens it too. Typing and saving fold
  nothing back, and a view the preview saves into a folded block (V) leaves it folded.
- **After that, VS Code keeps the folds as you left them.** Opening the file again, or
  reloading the window, shows each block folded or open as it was. So a slide you add keeps its
  settings open until you fold them (the fold arrow beside the line number, or the command
  below). A new lecture, whose file had no slide to fold when it opened, folds its settings from
  the next time it opens; until then they stay open, so the slide you are typing doesn't fold
  under the cursor.
- **Lysark: Fold or Unfold Slide Settings** (F1) folds every block if one on screen has its
  settings open, and otherwise opens every block. With no block on screen (in a long slide) it
  does the opposite of what it did last, starting by opening them (by folding them in a lecture
  that had nothing to fold when it opened).
- **Each slide starts with a separator:** a line across the text above the slide's opening
  `---`, the slide's number and id after it (`slide 4 · ptp`, or `slide 4` for a slide without
  an `id:`), also when the block is folded, and a mark in the scroll bar.
- **The outline is the slides' own headings.** The Outline view, the breadcrumbs above the
  text, Quick Outline (Ctrl+Shift+O) and sticky scroll show `# Baneplanlegging` and its 15
  slide titles. Before, they showed 24 headings, among them YAML comments and settings lines.
- The first lecture you open after starting VS Code shows its settings for about a second before
  they fold: VS Code waits for the Markdown extension's language server to start. A lecture
  opened after that folds within half a second, and one opened again is folded at once.
- If the file changed outside the window (a `git pull`, an edit on github.com), the blocks
  below the change can come back open, and VS Code doesn't fold them again. The command folds
  them.

## How it works

The code is `extension/src/navigation.ts` (the VS Code side) and `extension/src/slide-blocks.ts`
(finding the blocks, tested on its own).

**Which files.** A file counts as a lecture when its path ends in `lectures/<name>/slides.md`,
as the `lysark` command finds lectures, and a `package.json` above it depends on lysark (or is
the engine's own). Reading the `package.json` takes a moment; folding and separators wait for the
answer, but the plugin can't (see below), so until it comes the plugin counts a file at a
lecture's path as a lecture.

**The plugin.** VS Code's Markdown extension reads Markdown with a library called markdown-it,
and builds the Outline, the breadcrumbs, Quick Outline, sticky scroll and its own folding from
the headings markdown-it finds. To markdown-it a settings block is ordinary text, so a YAML
comment such as `# a full, deterministic starting configuration` is a heading, and so are the
settings lines just above a closing `---` (a line of text with `---` under it is Markdown's
other way to write a heading). Other extensions may add plugins to that markdown-it: Lysark says
so in its `package.json` (`"markdown.markdownItPlugins": true`) and hands the plugin over from
its `activate()`. The plugin sees each text before markdown-it reads it. If the text is exactly
the text of an open lecture, it blanks every settings block: each line from the opening `---`
to the closing `---` becomes empty. The text keeps its number of lines, so every heading stays
on its own line. Any other text is read as it is. The plugin gets only the text, not the file it
came from, which is why it compares the text with the open files.

The plugin and the folding belong together. Markdown makes a folding range for each heading's
section, and the false headings' sections cross the settings blocks. VS Code drops one of two
ranges that cross, so without the plugin 6 of Baneplanlegging's 15 blocks would not fold.

**Folding.** Lysark tells VS Code where each settings block is, as a folding range of the kind
"imports" (the kind programming languages use for the import lines at the top of a file).
VS Code folds such ranges if `editor.foldingImportsByDefault` is on, and Lysark turns it on for
Markdown files (`configurationDefaults` in its `package.json`). Markdown itself never makes
ranges of that kind, so other Markdown files get no new folds. VS Code folds them the first time
it has some to fold in an editor, and remembers that with the editor's other state (where you
were, what was folded), which it keeps when the editor closes. That is why a block you open
stays open, also after the file is opened again, and why a slide you add stays open.

One exception: in a file opened with nothing to fold (a new lecture), "the first time VS Code
has some to fold" would be the moment you finish typing the first slide's closing `---`; the
block would fold with the cursor in it and the cursor would jump to its first line. So Lysark
makes its ranges the "imports" kind only in a file that had a block to fold when it opened; in
any other file they are plain folding ranges, which VS Code never folds by itself.

An empty settings block (`---` right after `---`) has nothing to fold. The command uses
VS Code's own fold and unfold commands on every block. (VS Code's Toggle Import Fold would flip
each block on its own, so after you opened one by its ⋯ it would open all the others and fold
that one.)

**Separators.** A decoration on each slide's opening line: a 2-pixel line along its top, the
label after the `---`, and a mark in the scroll bar. It uses VS Code's theme colours (the colour
of links for the line, of descriptions for the label), so it follows the VS Code theme; the
rule that colours come from the tokens in `src/styles.css` is about the slides themselves. The
separators are drawn again 0.2 seconds after the typing stops.

**While you type a new slide.** Halfway through typing a new slide the compiler's rules go
wrong: the new opening `---` has no partner yet, so it pairs with the next slide's opening
`---`, and every body after it reads as settings and every settings block as a body. Often the
text then doesn't split into slides at all (the compiler would refuse it), but it can split
wrongly, for example when a later slide holds a code block with a `---` line; and an opening
code fence typed into a body swallows every slide after it until it is closed. So Lysark keeps
the settings blocks of the last text that split, wherever they still stand line for line, while
the text doesn't split, or splits without one of those blocks in a way only half-typed text
does: a `---` line of one of them has changed sides (an opening line now closes a block, as when
the new `---` pairs with the next slide's), or the text ends inside an open code fence. A
finished edit that makes a slide body text, such as a code fence put around a slide to show it
as an example, does neither, so it counts at once. The lone new `---` is blanked for the outline
too (by the compiler's rules it can only be a slide's first line), so the line of text above it
doesn't turn into a heading. The blocks after the new slide stay folded, keep their separators,
and the outline keeps their headings. In that moment the new slide's own lines are not hidden:
a YAML comment typed into its settings shows in the outline until its closing `---` is there.

A file that doesn't split into slides when it is opened (a half-typed slide that VS Code
restored, or text before the first `---`) is left as it is until it does: nothing tells its
bodies from its settings, and blanking a body would hide real headings. Once it splits, the
separators and the outline are there; its settings fold from the next time it opens, or with
the command.

## Limits and risks

- **The plugin takes a road VS Code doesn't document.** Plugins added with
  `markdown.markdownItPlugins` are documented for VS Code's Markdown preview. That the Outline
  and the rest use them too follows from how the Markdown extension is built: its language
  server asks the extension to parse each file, and the extension parses with the same
  markdown-it the plugins were added to (`extensions/markdown-language-features`,
  `src/client/client.ts`, the answer to `markdown/parse`). If VS Code changes that, the Outline,
  breadcrumbs, Quick Outline and sticky scroll go back to today's headings, and folding partly
  (the crossing ranges again); the separators keep working.
- **VS Code's own Markdown preview** of a lecture (not the Lysark preview) shows the settings
  blocks as empty lines, since it reads with the same markdown-it.
- **While typing**, as above; and the outline can show the old headings for a moment after a
  change, until VS Code asks again. The two signs of half-typed text can in principle be fooled
  by code examples that hold `---` lines further down: an opening code fence typed above them
  might then look finished, and until it is closed the blocks after it lose their folds (the
  command folds them again). Neither lecture tried (Baneplanlegging, the demo) has such code.
- **Remote windows in desktop VS Code** (a folder on another machine, in WSL, or in a container):
  Lysark prefers to run on your own computer, and the Markdown extension runs where the folder
  is, so the Markdown extension doesn't get the plugin. Then the outline shows the settings'
  headings, some blocks don't fold, and the fold command says it can't fold there (folding at
  the blocks' lines would fold slide text instead). Not tried.
- **A file at a lecture's path outside a Lysark course**, such as `lectures/<name>/slides.md` of
  another slide tool: its folding and separators wait for the `package.json` and are right, but
  if VS Code parses it before the `package.json` has been read, its outline can lack some
  headings until the first edit.
- **Files that aren't open.** Search for symbols in the whole workspace (Ctrl+T) also reads
  files that aren't open, and their settings still count as headings there.
- **Tried in VS Code for the web 1.147 Insiders** (the build `scripts/check-extension.mjs` pins),
  not yet in github.dev's stable VS Code, nor in desktop VS Code, which has the same Markdown
  extension, nor with a High Contrast theme.
- `editor.foldingImportsByDefault` is on for every Markdown file. An extension that made
  "imports" folding ranges in Markdown would get them folded too; none is known.

## Not built

Proposals for the author; none of these is in 0.4.0.

- **Fold every block each time the file opens.** Today VS Code folds the blocks the first time a
  lecture opens in an editor and then keeps the folds as you left them, which the prototype
  showed; a slide you add stays open until you fold it. If "folded every time the file opens"
  should hold for every block, also those you opened and those you added, Lysark could run the
  fold on every block whenever a lecture's editor opens. That throws away the folds as you left
  them, so it is the author's call.
- **Guessing the settings in a file opened half typed.** The hands-on test suggested pairing
  the `---` lines of such a file by whether the lines between them read as YAML settings. Not
  built: a body of nothing but headings reads as empty YAML (a Markdown heading is a YAML
  comment), so the guess would hide such a body's headings. The file is left as it is until it
  splits, which is what the plugin may always do.
- **The plugin in Remote windows.** With `"extensionKind": ["workspace", "ui"]` Lysark would run
  beside the Markdown extension on the remote side, and the plugin would reach it; the preview
  would then fetch the course site from the remote machine. Not tried.
- **The preview opening on the cursor's slide.** The hands-on test found that the Lysark preview
  opens on slide 1 even with the cursor in slide 4, and follows the cursor only once it moves
  (`Preview.slide` in `extension/src/extension.ts` starts at 0). Opening on the cursor's slide
  is a small change to the preview, outside this work.

## How to check it

- **Unit tests:** `extension/src/slide-blocks.test.ts`, with the engine's tests
  (`npx vitest run --exclude ".claude/**"`): which paths are lectures; the blocks with `\n` and
  `\r\n` line endings and a byte order mark, a slide without an id, an empty block, a `---`
  inside a code block; a new slide half typed in the middle and at the end, a `---` typed under
  a line of text, a `---` typed where the text then splits wrongly, a code fence left open, a
  slide put inside a code fence; a file opened unfinished; when blocks are "imports"; what the
  command does with blocks on screen and without; and that the blanked demo lecture leaves
  markdown-it only the slides' headings.
- **The real extension in VS Code for the web:** `node scripts/check-extension.mjs <editor dir>`
  starts by opening the demo lecture's `slides.md` and requires: every settings block folded
  (its opening `---` shown, its settings and closing `---` not, every other line shown); each
  slide's opening line labelled `slide N · id`; Quick Outline listing exactly the headings of
  the text without its settings blocks; the fold command opening every block, folding them all,
  folding them all after the ⋯ of one was clicked, and opening them again; a slide typed between
  the first two, a line at a time, staying open while every other block stays folded and the
  labels after it count on (without `SlideTracker` the blocks after it come back open); a
  `README.md` with a heading between two `---` lines, and a `slides.md` at the top of the course
  that splits by Lysark's rules, both keeping all their headings, with nothing folded and no
  separator; and the first slide typed into an empty `lectures/new/slides.md` staying open, with
  the cursor where it was typed and its separator drawn.
- **By hand, in github.dev on Baneplanlegging,** once 0.4.0 is on the Marketplace: open
  `slides.md`. Every settings block is folded and each slide starts with its separator. The
  Outline view (in the Explorer) lists `# Baneplanlegging` and the 15 slide titles. Try the
  command, a click on a ⋯, V in the preview on a slide with its block folded (the block stays
  folded), and a new slide typed between two others (the blocks after it stay folded).
