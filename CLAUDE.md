# Lysark

A framework for interactive robotics lecture slides: DOM overlay slides plus declarative three.js
scenes, with PID/spring-damper motion as pedagogical content.

- **Direction and work order:** [docs/lysark-v2.md](docs/lysark-v2.md). Read it before starting
  any work; it supersedes the runtime reference where the two conflict.
- **How the runtime works:** [docs/lysark-design.md](docs/lysark-design.md), the runtime
  reference. Code comments citing `spec §N` refer to its sections.
- **Current state for resuming work:** [docs/handover.md](docs/handover.md).
- Older design material is archived in [docs/archive/](docs/archive/).

## Working agreement (from lysark-v2.md section 6)

- Work happens in the steps of lysark-v2.md, one step at a time. Each step lands on `main` small
  enough for the author to run it and understand it before the next starts, with a short
  plain-language note in `docs/` on how it works.
- The engine feature freeze ended with v2 step 2 (2026-10-15). An engine feature a lecture needs
  is its own small change, landed and understood before the lecture uses it — never a side effect
  of writing a lecture. Anything outside the current step is still written down as a proposal for
  the author first.
- Decisions marked "Proposed" in lysark-v2.md section 8 are not confirmed. Don't build on one
  without the author's confirmation.

## Working instructions

- **Dig deeper rather than defer.** When something new, ambiguous, or unexpected appears — an API
  limitation, a design gap, a failing assumption — investigate and resolve it in the moment. Do
  not leave TODOs, "revisit later" notes, or stub implementations without flagging them explicitly
  and proposing a concrete resolution.
- Be concise and direct. Lead with the answer or decision, then reasoning only where the topic
  requires it. No preamble, no filler.
- Be specific and actionable. When a choice arises, pick one and defend it; present alternatives
  only when the tradeoff genuinely matters.
- Minimal formatting. Plain prose unless structure genuinely aids clarity.
- Push back. If an instruction in the design docs conflicts with something discovered during
  implementation, say so plainly and propose the fix — do not silently comply or silently deviate.
- Skip boilerplate caveats. Flag only real risks.
- Match the user's language (Norwegian or English) in discussion; code, comments, and docs in
  English.

## Hard constraints to keep in mind while coding

Section numbers refer to docs/lysark-design.md.

- The student-offline build must run double-clicked from `file://`: no runtime `fetch`, no dynamic
  `import()`, no workers-from-URL, no CDN references — anywhere. Assets load from strings with
  `parse()`-style loader APIs only. See §9.
- At most one scene's GPU resources alive at a time; render loop fully stopped on scene-less
  slides. See §4.1.
- Text is never rendered inside the WebGL scene. See §4.2.
- Theme colours (page and 3D background, text, accents, grid, plots, traces, ghost) come from the
  CSS tokens at the top of `src/styles.css`. Scripts read them with `themeColor()` from
  `src/theme.ts` when they draw, never at import time, or the print theme breaks (lysark-v2.md
  step 2). New code adds a token rather than a colour literal. The remaining literals (scene
  object materials and lights) stay until the postponed theme work in lysark-v2.md section 7;
  don't remove them as a side task.
- The slide compiler never reads files; it reports what it needs and the caller reads them, so it
  can also run in the browser (lysark-v2.md section 5, design rules).
