---
id: title
scene: arm
layout: center
camera:
  lookAt: [0, 0.45, 0]
  offset: [1.9, 0.9, 1.9]
idle:
  joint1: { amp: 0.35, freq: 0.12 }
  joint2: { amp: 0.14, freq: 0.1, phase: 1.6 }
  joint3: { amp: 0.22, freq: 0.08, phase: 3.0 }
---
# Lysark

## Robot motion as lecture content

Use **→ / space** to advance, **←** to go back, **d** for the debug panel.

---
id: pid-control
scene: arm
joints:
  joint1: 0.9
  joint2: 1.1
  joint3: -1.5
camera:
  lookAt: [0.1, 0.5, 0]
  offset: [1.3, 0.55, 1.1]
---
## Joint control is a PID loop

Every joint you just saw move is driven by

$$\tau = K_p e + K_i \int e\,dt + K_d \dot e$$

<!-- pause -->
- the error $e$ is the distance to the setpoint
<!-- pause -->
- on a unit-inertia joint this gives $\zeta \approx \dfrac{K_d}{2\sqrt{K_p}}$

---
id: control-loop
scene: arm
camera:
  lookAt: [0.1, 0.5, 0]
  offset: [1.5, 0.5, 1.3]
---
## The loop, drawn

<figure>
<svg viewBox="0 0 470 130" role="img" aria-label="PID feedback control loop">
  <defs>
    <marker id="lysark-arrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#8b9096" />
    </marker>
  </defs>
  <g fill="none" stroke="#8b9096" stroke-width="1.5" marker-end="url(#lysark-arrow)">
    <line x1="26" y1="40" x2="58" y2="40" />
    <line x1="86" y1="40" x2="150" y2="40" />
    <line x1="242" y1="40" x2="300" y2="40" />
    <line x1="394" y1="40" x2="452" y2="40" />
    <path d="M424,40 L424,102 L72,102 L72,54" />
  </g>
  <circle cx="72" cy="40" r="13" fill="none" stroke="#f0a24a" stroke-width="1.5" />
  <text x="72" y="45" text-anchor="middle" fill="#d7dade" font-size="14">Σ</text>
  <text x="58" y="70" text-anchor="middle" fill="#e58a8a" font-size="15">−</text>
  <rect x="150" y="24" width="92" height="32" rx="6" fill="rgba(240,162,74,0.12)" stroke="#f0a24a" />
  <text x="196" y="45" text-anchor="middle" fill="#d7dade" font-size="14">PID</text>
  <rect x="300" y="24" width="94" height="32" rx="6" fill="rgba(240,162,74,0.12)" stroke="#f0a24a" />
  <text x="347" y="45" text-anchor="middle" fill="#d7dade" font-size="14">joint</text>
  <text x="20" y="30" text-anchor="middle" fill="#9aa0a6" font-size="13">θ*</text>
  <text x="271" y="34" text-anchor="middle" fill="#9aa0a6" font-size="13">τ</text>
  <text x="458" y="30" text-anchor="end" fill="#9aa0a6" font-size="13">θ</text>
</svg>
<figcaption>Setpoint θ*, controller, plant, and the measured angle θ fed back — negative at the summing junction.</figcaption>
</figure>

---
id: overshoot
scene: arm
joints:
  joint2: 0.3
camera:
  lookAt: [0, 0.5, 0]
  offset: [1.5, 0.35, 0.6]
widgets:
  - type: slider
    bind: joint2
    label: joint2 setpoint
    pid: { kp: 12, ki: 0, kd: 0.8 }
  - type: plot
    bind: joint2.error
    label: tracking error e (rad)
    range: [-1.4, 1.4]
    window: 8
---
## Watch the overshoot

This slide lowers $K_d$ to **0.8** — the damping ratio drops to
$\zeta \approx 0.12$.

Drag the setpoint and watch the error ring through zero before it settles.

---
id: end-effector
scene: arm
joints:
  joint1: 0.2
  joint2: 0.9
  joint3: -0.7
camera:
  lookAt: end_effector
  offset: [0.4, 0.22, 0.5]
  spring: { omega: 5, zeta: 1.0 }
anchored:
  - anchor: end_effector
    offset: [30, -16]
    content: "$x_e$"
---
## The camera is a spring too

This close-up move is a critically damped spring-damper
($\omega = 5$, $\zeta = 1$) — the same math as the joints,
tuned to never overshoot.

<!-- pause -->
The $x_e$ label is a DOM element **pinned to the end-effector link** — it
fades in once the camera and joints settle, and tracks the node every frame.

---
id: damping-regimes
scene: arm
camera:
  lookAt: [0, 0.45, 0]
  offset: [2.2, 1.3, 2.2]
  spring: { omega: 4, zeta: 0.5 }
---
## Damping regimes

That pull-back was **underdamped** ($\zeta = 0.5$) — did you see it float past
and swing back?

<!-- pause -->
- $\zeta < 1$ — overshoots, oscillates, settles
<!-- pause -->
- $\zeta = 1$ — critically damped: fastest approach with no overshoot
<!-- pause -->
- $\zeta > 1$ — overdamped: slow, creeping approach

<!-- pause -->
Every camera move and joint transition in this deck is one of these three.

---
id: pendulum-cut
scene: pendulum
---
## A new scene, a hard cut

The arm you just saw was **suspended** — its state serialized, its GPU
resources freed — and this pendulum took its place under a crossfade.

<!-- pause -->
Step **backward** across the boundary and the arm comes back exactly as
you left it.

---
id: pendulum-swing
scene: pendulum
joints:
  swing: 1.1
camera:
  lookAt: bob
  offset: [0.9, 0.1, 1.3]
widgets:
  - type: slider
    bind: swing
    label: swing setpoint
    pid: { kp: 9, ki: 0, kd: 0.3 }
  - type: plot
    bind: swing.measured
    label: swing angle (rad)
    window: 8
---
## Same math, different plant

One channel, same PID loop: $\zeta \approx \dfrac{K_d}{2\sqrt{K_p}} \approx 0.05$
on this slide.

Drag the setpoint — the pendulum rings hard before it settles.

---
id: outro
layout: center
---
## Scene-less slide

The canvas is gone and the render loop is **stopped** — zero GPU work
right now.

<!-- pause -->
Text, math, and media still work, because the overlay never depended on
WebGL:

$$e^{i\pi} + 1 = 0$$
