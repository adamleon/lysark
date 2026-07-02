# Lysark

A framework for interactive robotics lecture slides: DOM overlay slides plus declarative three.js
scenes, with PID/spring-damper motion as pedagogical content. The authoritative spec is
[docs/lysark-design.md](docs/lysark-design.md); the original research report and addendum are
archived in [docs/archive/](docs/archive/).

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
- Push back. If an instruction in the design doc conflicts with something discovered during
  implementation, say so plainly and propose the fix — do not silently comply or silently deviate.
- Skip boilerplate caveats. Flag only real risks.
- Match the user's language (Norwegian or English) in discussion; code, comments, and docs in
  English.

## Hard constraints to keep in mind while coding

- The student-offline build must run double-clicked from `file://`: no runtime `fetch`, no dynamic
  `import()`, no workers-from-URL, no CDN references — anywhere. Assets load via base64 +
  `parse()`-style loader APIs only. See spec §9.
- At most one scene's GPU resources alive at a time; render loop fully stopped on scene-less
  slides. See spec §4.1.
- Text is never rendered inside the WebGL scene. See spec §4.2.
