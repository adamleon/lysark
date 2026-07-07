---
id: tittel
scene: agilus
layout: center
camera:
  lookAt: [-1.75, 0.5, 0]
  offset: [0.7, 1.2, 3.6]
  spring: { omega: 4, zeta: 1.0 }
idle:
  joint_1: { amp: 0.5, freq: 0.07 }
  joint_2: { amp: 0.22, freq: 0.06, phase: 1.6 }
  joint_4: { amp: 0.7, freq: 0.09, phase: 3.0 }
---
# Baneplanlegging

## AIS2105 – Mekatronikk og robotikk

Fra **konfigurasjon** til ferdig **rute** – og hvorfor *hvordan* er like viktig
som *hvor*.

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
  lookAt: [-0.5, 0.62, 0]
  offset: [1.15, 0.72, 2.6]
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

En **konfigurasjon** er settet av leddverdier som fastlegger robotens stilling
entydig – vinkelen på hvert dreieledd og lengden på hvert skyveledd. Vi samler
dem i én vektor:

$$q = (q_1, q_2, \dots, q_n) \in \mathcal{C} \subset \mathbb{R}^n$$

<!-- pause -->
Mengden av *alle* mulige konfigurasjoner er **konfigurasjonsrommet**
$\mathcal{C}$. For denne KUKA-en er $n = 6$: hvert punkt i $\mathcal{C}$ svarer
til nøyaktig én stilling.

<!-- pause -->
Verktøyets stilling er forover-kinematikken $x = f(q)$ – en *ulineær* avbildning
fra ledd- til arbeidsrom. Den ulineariteten er kjernen i forelesningen.

---
id: bane
scene: agilus
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
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

En **bane** er en sammenhengende avbildning fra en baneparameter $s$ inn i
konfigurasjonsrommet:

$$\mathbf{q}(s) : [0, 1] \to \mathcal{C} \subset \mathbb{R}^n, \qquad \mathbf{q}(0) = q_0, \quad \mathbf{q}(1) = q_f$$

<!-- pause -->
Legg merke til: her er det **ingen tid** ennå – banen sier bare *hvor* roboten
er langs ruten, ikke *når*. Det er ren geometri.

<!-- pause -->
Den enkleste banen er en rett linje i leddrommet:

$$\mathbf{q}(s) = q_0 + s\,(q_f - q_0)$$

---
id: ptp
scene: agilus
camera:
  lookAt: [-1.1, 0.5, 0]
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

Den enkleste ruten interpolerer **leddene** lineært fra $q_0$ til $q_f$ – kalt
PTP eller MoveJ:

$$\mathbf{q}(s) = s\,\mathbf{q}_f + (1-s)\,\mathbf{q}_0, \qquad \dot{\mathbf{q}}(s) = \mathbf{q}_f - \mathbf{q}_0, \qquad \ddot{\mathbf{q}}(s) = 0$$

Hvert ledd beveger seg med jevn takt i $s$ – leddkurvene er **rette linjer**.

<!-- pause -->
Men fordi kinematikken $x = f(q)$ er ulineær, blir verktøybanen (gul) en *krum*
kurve, ikke den rette linjen (grønn) mellom start og mål. Rask og alltid mulig,
men verktøyet svinger ut.

---
id: lin
scene: agilus
camera:
  lookAt: [-1.1, 0.5, 0]
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

Nå legger vi den rette linjen i **arbeidsrommet** i stedet – posisjonen $x$
interpoleres lineært (Lin, MoveL):

$$\mathbf{x}(s) = s\,\mathbf{x}_B + (1-s)\,\mathbf{x}_A, \qquad \dot{\mathbf{x}}(s) = \mathbf{x}_B - \mathbf{x}_A, \qquad \ddot{\mathbf{x}}(s) = 0$$

Invers kinematikk løser leddvinklene $q$ i hvert steg slik at verktøyet følger den
rette linjen (grønn). Endepunktene $\mathbf{x}_A = f(q_0)$ og $\mathbf{x}_B = f(q_f)$
er de samme som i PTP.

<!-- pause -->
Prisen: leddene vrir seg **ulineært** – leddkurvene blir krumme. Og verktøyet har
også en **orientering** som må dreies jevnt fra start til mål: hvordan
interpolerer man en rotasjon?

---
id: translasjon-rotasjon
layout: center
---
## Lineær translasjon og rotasjon

En full stilling i arbeidsrommet er både en **posisjon** $\mathbf{t}$ og en
**orientering** $\mathbf{R} \in \mathrm{SO}(3)$. Translasjonen interpolerer vi
rett fram:

$$\mathbf{t}(s) = s\,\mathbf{t}_B + (1-s)\,\mathbf{t}_A$$

<!-- pause -->
Rotasjoner kan vi *ikke* interpolere komponentvis – summen av to
rotasjonsmatriser er ingen rotasjonsmatrise. Vi må følge den **korteste veien**
på rotasjonsgruppen. Den relative rotasjonen $\mathbf{R}_A^\top\mathbf{R}_B$
skaleres jevnt med $s$:

$$\mathbf{R}(s) = \mathbf{R}_A \exp\!\big( \log(\mathbf{R}_A^\top \mathbf{R}_B)\, s \big)$$

<!-- pause -->
Her er $\exp$ og $\log$ **matrise**-eksponent og -logaritme, ikke de skalare. De
neste to sidene forklarer hva det betyr.

---
id: matriseeksponent
layout: center
---
## Eksponent av en matrise

Matriseeksponenten er definert av nøyaktig samme rekke som den skalare
$e^{x} = \sum x^n / n!$, bare med matrisepotenser:

$$e^{\mathbf{A}} = \sum_{n=0}^{\infty} \frac{\mathbf{A}^n}{n!} = \mathbf{I} + \mathbf{A} + \frac{\mathbf{A}^2}{2!} + \frac{\mathbf{A}^3}{3!} + \cdots$$

<!-- pause -->
Den løser den lineære differensialligningen $\dot{\mathbf{x}} = \mathbf{A}\mathbf{x}$
med løsning $\mathbf{x}(t) = e^{\mathbf{A}t}\,\mathbf{x}_0$. Vi bruker den til å
bygge en rotasjon opp fra en konstant vinkelhastighet.

---
id: rotasjonsmatrise
layout: center
---
## Eksponent av en rotasjonsmatrise

En rotasjon om en enhetsakse $\hat{\mathbf{k}}$ med vinkel $\theta$ er nettopp
matriseeksponenten av den skjevsymmetriske matrisen $[\hat{\mathbf{k}}]_\times$
skalert med $\theta$:

$$\mathbf{R}(\hat{\mathbf{k}}, \theta) = e^{[\hat{\mathbf{k}}]_\times \theta}, \qquad \log\!\big(\mathbf{R}(\hat{\mathbf{k}}, \theta)\big) = [\hat{\mathbf{k}}]_\times\, \theta$$

<!-- pause -->
der $[\hat{\mathbf{k}}]_\times$ er kryssprodukt-matrisen:

$$[\hat{\mathbf{k}}]_\times = \begin{bmatrix} 0 & -k_z & k_y \\ k_z & 0 & -k_x \\ -k_y & k_x & 0 \end{bmatrix}$$

<!-- pause -->
Rekka summerer seg til **Rodrigues' formel** i lukket form:

$$\mathbf{R}(\hat{\mathbf{k}}, \theta) = \mathbf{I} + \sin\theta\,[\hat{\mathbf{k}}]_\times + (1 - \cos\theta)\,[\hat{\mathbf{k}}]_\times^{\,2}$$

Slik blir rotasjonsinterpolasjonen en jevn dreining om **én fast akse** – like
enkel som en glidning langs én rett linje.

---
id: rute
layout: center
---
## Bane + tid = rute

En **rute** (trajectory) er en bane der vi også vet *når* vi er hvor. Vi legger
på en **tidsskalering** $s(t)$ som styrer framdriften langs banen:

$$s(t) : [t_0, t_f] \to [0, 1], \qquad s(t_0) = 0, \quad s(t_f) = 1$$

<!-- pause -->
Kjerneregelen (regelen for å derivere en sammensatt funksjon) gir ledd-fart og
-akselerasjon fra banegeometrien og tidsskaleringen:

$$\dot{\mathbf{q}}(t) = \frac{d\mathbf{q}}{ds}\,\dot{s}, \qquad \ddot{\mathbf{q}}(t) = \frac{d^2\mathbf{q}}{ds^2}\,\dot{s}^{\,2} + \frac{d\mathbf{q}}{ds}\,\ddot{s}$$

<!-- pause -->
Geometrien $\mathbf{q}(s)$ er fast. Nå står valget om **$s(t)$** – og hvor glatt
ruten blir, avhenger av hvor mange deriverte av $s$ vi holder kontinuerlige.

---
id: kubisk-utledning
layout: center
---
## Tredjeordens polynom – utledning

Den enkleste glatte tidsskaleringen er et **tredjeordens** (kubisk) polynom:

$$s(t) = a_0 + a_1 t + a_2 t^2 + a_3 t^3$$
$$\dot{s}(t) = a_1 + 2 a_2 t + 3 a_3 t^2, \qquad \ddot{s}(t) = 2 a_2 + 6 a_3 t$$

<!-- pause -->
Vi setter tidsvinduet til $[0, T]$ (altså $t_0 = 0$, $t_f = T$, med $T$ som total
kjøretid). Fire ukjente, fire randbetingelser: $s = 0,\ \dot{s} = 0$ ved $t = 0$
og $s = 1,\ \dot{s} = 0$ ved $t = T$. Løst gir det

$$a_0 = 0, \qquad a_1 = 0, \qquad a_2 = \frac{3}{T^2}, \qquad a_3 = -\frac{2}{T^3}$$

<!-- pause -->
$$s(t) = 3\left(\tfrac{t}{T}\right)^2 - 2\left(\tfrac{t}{T}\right)^3$$

---
id: kubisk
scene: agilus
layout: graph
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
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
## Tredjeordens polynom – geometrisk glatt

Farten $\dot{s}$ hviler i null i endene, men akselerasjonen **hopper**:

$$\ddot{s}(0) = \frac{6}{T^2}, \qquad \ddot{s}(T) = -\frac{6}{T^2}$$

Uendelig **rykk** ($\dddot{s} \to \infty$) i endepunktene – *geometrisk* glatt,
men ikke *fysisk* glatt. Roboten rykker i gang og stopper brått.

---
id: trapes
scene: agilus
layout: graph
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  profile: trapezoidal
  duration: 1.4
  dwell: 0.7
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: curve
    profile: trapezoidal
    show: [s, v, a]
    label: Trapes – s, ṡ, s̈
---
## Trapes – enklest å implementere

Konstant fart i midten, konstant akselerasjon på ramper opp og ned:

$$\ddot{s}(t) = \begin{cases} +a & 0 \le t \le t_a \\ 0 & t_a \le t \le T - t_a \\ -a & T - t_a \le t \le T \end{cases}$$

**Stykkevis konstant** akselerasjon – hoppene gir fortsatt rykk. Enkel og billig,
men ikke fysisk glatt.

---
id: s-kurve
scene: agilus
layout: graph
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
  spring: { omega: 4, zeta: 1.0 }
trajectory:
  profile: scurve
  duration: 1.6
  dwell: 0.7
  from: { joint_1: -1.5, joint_2: -0.5, joint_3: 1.3, joint_4: 0.0, joint_5: 0.7, joint_6: 0.0 }
  to:   { joint_1:  1.5, joint_2: -1.6, joint_3: 0.4, joint_4: 0.0, joint_5: 1.3, joint_6: 0.0 }
widgets:
  - type: curve
    profile: scurve
    show: [s, v, a]
    label: S-kurve – s, ṡ, s̈
---
## S-kurve – begrenset rykk

Akselerasjonen **ramper opp og ned** i stedet for å slås på momentant – den blir
selv en trapes, satt sammen av sju faser.

Både $\dot{s}$ og $\ddot{s}$ hviler i null i endene, og rykket $\dddot{s}$ er
**endelig** overalt. Fysisk glatt, med begrenset rykk.

---
id: femteordens
scene: agilus
layout: graph
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
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

Med **akselerasjonen** også hvilende i null i endene (seks randbetingelser) blir
tidsskaleringen et femteordens polynom:

$$s(t) = 10\left(\tfrac{t}{T}\right)^3 - 15\left(\tfrac{t}{T}\right)^4 + 6\left(\tfrac{t}{T}\right)^5$$

$\ddot{s} = 0$ i begge ender gir kontinuerlig, jevnt rykk. *Fysisk* glatt.

---
id: sammenligning
scene: agilus-duo
layout: graph
camera:
  lookAt: [-1.1, 0.55, 0]
  offset: [0.6, 1.5, 3.2]
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
    label: Framdrift i tid
  - type: compare
    profiles: [cubic, quintic]
    labels: [kubisk, femteordens]
    quantities: [s, v, a]
  - type: toggle
    label: Solid robot
    labels: [kubisk, femteordens]
---
## Kubisk vs. femteordens – samtidig

**To roboter oppå hverandre**: hvit med kubisk, **grønn** med femteordens. De
starter og stopper likt, men **skiller lag underveis** – tydeligst i
akselerasjonen: kubisk spretter fra $6/T^2$ til null, femteordens hviler i null.
