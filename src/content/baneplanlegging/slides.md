---
id: tittel
scene: agilus
layout: center
idle:
  joint_1: { amp: 0.5, freq: 0.07 }
  joint_2: { amp: 0.22, freq: 0.06, phase: 1.6 }
  joint_4: { amp: 0.7, freq: 0.09, phase: 3.0 }
---
# Baneplanlegging

## AIS2105 – Mekatronikk og robotikk

Fra **konfigurasjon** til ferdig **rute**: hvordan vi får en robot til å flytte
seg fra A til B – og hvorfor *hvordan* er like viktig som *hvor*.

---
id: konfigurasjon
scene: agilus
# a full, deterministic starting configuration so the q-vector reads the same
# every visit (no residue from the title slide's idle sweep) and every joint has
# a defined rest pose
joints:
  joint_1: 0.3
  joint_2: -0.6
  joint_3: 0.9
  joint_4: 0.0
  joint_5: 0.9
  joint_6: 0.0
camera:
  lookAt: tool0
  offset: [1.6, 0.7, 1.6]
  spring: { omega: 5, zeta: 1.0 }
widgets:
  - type: slider
    bind: joint_2
    label: ledd 2 (skulder)
  - type: slider
    bind: joint_4
    label: ledd 4 (håndledd)
anchored:
  - anchor: tool0
    offset: [70, 0]
    vector:
      symbol: q
      joints: [joint_1, joint_2, joint_3, joint_4, joint_5, joint_6]
      digits: 2
---
## Hva er en konfigurasjon?

En **konfigurasjon** er settet av leddverdier som gir roboten én bestemt
stilling – vinkelen på hvert dreieledd (og lengden på hvert skyveledd).

<!-- pause -->
Vi samler dem i én vektor $q = (q_1, \dots, q_n)$. Mengden av *alle* mulige
konfigurasjoner er **konfigurasjonsrommet** $\mathcal{C}$.

<!-- pause -->
Dra i leddene – hver innstilling er ett punkt i $\mathcal{C}$, og roboten er
den direkte avbildningen av det punktet.

---
id: bane
scene: agilus
camera:
  lookAt: [0, 0.55, 0]
  offset: [0.6, 1.5, 3.4]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  control: slider
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: path
    label: baneparameter s
---
## Banen q(s) – ren geometri

En **bane** er en sammenhengende sekvens av konfigurasjoner
$q(s),\; s \in [0, 1]$: fra start $q(0) = q_0$ til slutt $q(1) = q_f$. Den
enkleste er en rett linje i leddrommet, $q(s) = q_0 + s\,(q_f - q_0)$.

<!-- pause -->
Legg merke til: **ingen tid** ennå – bare *hvor* roboten er, ikke *når*. Dra i
$s$ og skru hele roboten gjennom banen.

---
id: ptp
scene: agilus
camera:
  lookAt: [0, 0.5, 0]
  offset: [0.4, 2.3, 2.5]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  control: slider
  space: joint
  trace: [joint, task]
  from: { joint_1: -1.2, joint_2: -0.7, joint_3: 1.1, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.2, joint_2: -1.2, joint_3: 0.5, joint_4: 0.0, joint_5: 1.2, joint_6: 0.0 }
widgets:
  - type: path
    label: framdrift s
  - type: jointgraph
    label: Leddverdier q(s)
---
## PTP / MoveJ – rett i leddrommet

Den enkleste ruten: interpolér **leddene** lineært fra $q_0$ til $q_f$, akkurat
som på forrige side. Rask og alltid mulig – men se hva verktøyet (tool0) gjør.

<!-- pause -->
Dra i $s$: verktøyet følger den **gule** banen – en *krum* kurve, ikke en rett
linje. Den grønne streken viser den rette linjen mellom start og mål.

---
id: lin
scene: agilus
camera:
  lookAt: [0, 0.5, 0]
  offset: [0.4, 2.3, 2.5]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  control: slider
  space: task
  trace: [joint, task]
  from: { joint_1: -1.2, joint_2: -0.7, joint_3: 1.1, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.2, joint_2: -1.2, joint_3: 0.5, joint_4: 0.0, joint_5: 1.2, joint_6: 0.0 }
widgets:
  - type: path
    label: framdrift s
  - type: jointgraph
    label: Leddverdier q(s)
---
## Lin / MoveL – rett i arbeidsrommet

Nå tvinger vi **verktøyet** til å følge den rette linjen (grønn). Invers
kinematikk løser leddvinklene i hvert steg, så tool0 går rett fram.

<!-- pause -->
Dra i $s$: verktøyet går rett, men roboten må vri seg mer for å få det til.
Samme start og mål som PTP – helt ulik verktøybane (sammenlign med den gule).

---
id: kubisk
scene: agilus
camera:
  lookAt: [0, 0.55, 0]
  offset: [0.6, 1.5, 3.4]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  profile: cubic
  duration: 1.4
  dwell: 0.7
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: curve
    profile: cubic
    show: [s, v, a]
    label: Kubisk – s, ṡ, s̈
---
## Kubisk polynom – geometrisk glatt

En bane blir en **rute** når vi legger på en tidsskalering $s(t)$: *hvor* langs
banen vi er til hver tid. Nå kjører **hele roboten** $q(s(t))$ fra $q_0$ til
$q_f$. Det tredjeordens (kubiske) polynomet

$$s(t) = 3\left(\tfrac{t}{T}\right)^2 - 2\left(\tfrac{t}{T}\right)^3$$

starter og stopper med **null hastighet** – men se på akselerasjonen $\ddot s$
i plottet: den er *ikke* null i endene.

<!-- pause -->
Roboten **rykker** i gang og stopper brått – geometrisk glatt, men ikke *fysisk*
glatt (uendelig rykk i endepunktene).

---
id: femteordens
scene: agilus
camera:
  lookAt: [0, 0.55, 0]
  offset: [0.6, 1.5, 3.4]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  profile: quintic
  duration: 1.4
  dwell: 0.7
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: curve
    profile: quintic
    show: [s, v, a]
    label: Femteordens – s, ṡ, s̈
---
## Femteordens polynom – fysisk glatt

Samme bane, samme tid – men krever vi at også **akselerasjonen** skal være null
i endene, trengs et femteordens polynom:

$$s(t) = 10\left(\tfrac{t}{T}\right)^3 - 15\left(\tfrac{t}{T}\right)^4 + 6\left(\tfrac{t}{T}\right)^5$$

<!-- pause -->
Nå glir hele roboten mykt i gang og til ro: $\ddot s = 0$ i begge ender gir
begrenset rykk. *Fysisk* glatt.

---
id: sammenligning
scene: agilus-duo
camera:
  lookAt: [0, 0.55, 0]
  offset: [0.6, 1.5, 3.4]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  control: time
  profile: cubic
  compare: quintic
  duration: 1.4
  dwell: 0.7
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: transport
    label: Tid – kjør eller dra manuelt
  - type: compare
    profiles: [cubic, quintic]
    labels: [kubisk, femteordens]
    quantities: [s, v, a]
  - type: toggle
    label: Solid robot
    labels: [kubisk, femteordens]
---
## Kubisk vs. femteordens – samtidig

Samme bane, samme tid, kjørt av **to roboter oppå hverandre**: den hvite med
tredjeordens, den **grønne** med femteordens tidsskalering.

<!-- pause -->
De starter og stopper likt, men **skiller lag underveis**. Velg posisjon,
hastighet eller akselerasjon i grafen, og **kjør** eller dra i tidsslideren –
markøren følger bevegelsen. Knappen bytter hvilken robot som er solid.
