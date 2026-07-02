---
id: title
scene: arm
layout: center
camera:
  lookAt: [0, 0.45, 0]
  offset: [1.9, 0.9, 1.9]
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
---
## Watch the overshoot

This slide lowers $K_d$ to **0.8** — the damping ratio drops to
$\zeta \approx 0.12$.

Drag the setpoint and watch the joint ring before it settles.

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
---
## The camera is a spring too

This close-up move is a critically damped spring-damper
($\omega = 5$, $\zeta = 1$) — the same math as the joints,
tuned to never overshoot.

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
