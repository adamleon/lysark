# Lysark — Design Addendum

Append to the design document. Overrides anything in conflict.

## Scene lifecycle

- A deck is an ordered list of **scenes**, each declaring a slide range (e.g. `slides: 4–11`). Multiple scenes per deck is the normal case, not an extension.
- **Within a range:** persistent scene behavior. Camera and robot state carry across slides; transitions are PID/spring-damper interpolation toward each slide's declared target state. Nothing reloads.
- **Across a boundary:** no camera continuity. Transition is a crossfade or cut, optionally through an overlay-only slide. Do not attempt clever 3D transitions between unrelated scenes.
- **Suspend/restore:** on leaving a scene, serialize its state (joint positions, camera pose, widget values), destroy GPU resources. Rebuild and restore on re-entry, including backward navigation. Never keep multiple scenes' GPU resources alive simultaneously.

## Scene-less slides

- Slides may exist outside any scene range. First-class concept, not an empty scene.
- On scene-less slides the WebGL canvas is unmounted/hidden and the render loop is **paused** — zero GPU work. Only the overlay layer renders (text, KaTeX, video, plots).
- Scene → scene-less transition fades the canvas out, never yanks it. Re-entering a scene uses the same serialize/restore mechanism as scene-to-scene boundaries.

## Overlay system

Two positioning modes per overlay element:

- `screen:` — fixed screen-space layout. Bullets, headings, equations. Transitions are DOM fades/slides. Default mode.
- `anchor: <node>` — element is still DOM (crisp text, KaTeX works), but its position is computed per frame by projecting a 3D point (e.g. `robot.link6`) to screen space, plus optional screen-space offset. CSS2DRenderer-style. Occlusion hiding via raycast is optional, off by default.

Text is never rendered inside the WebGL scene. The "text lives in the world" illusion comes from choreographing camera settle + anchored-element fade-in.

## Working instructions for Claude Code

- **Dig deeper rather than defer.** When something new, ambiguous, or unexpected appears — an API limitation, a design gap, a failing assumption — investigate and resolve it in the moment. Do not leave TODOs, "revisit later" notes, or stub implementations without flagging them explicitly and proposing a concrete resolution.
- Be concise and direct. Lead with the answer or decision, then reasoning only where the topic requires it. No preamble, no filler.
- Be specific and actionable. When a choice arises, pick one and defend it; present alternatives only when the tradeoff genuinely matters.
- Minimal formatting. Plain prose unless structure genuinely aids clarity.
- Push back. If an instruction in this document conflicts with something discovered during implementation, say so plainly and propose the fix — do not silently comply or silently deviate.
- Skip boilerplate caveats. Flag only real risks.
- Match the user's language (Norwegian or English) in discussion; code, comments, and docs in English.
