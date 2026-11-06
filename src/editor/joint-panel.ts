/**
 * The panel's joint sliders (J, docs/scene-files.md): one per joint of the
 * robot on the slide shown. A slider moves its joint at once, as a teach
 * pendant jogs it; P then saves the pose (runtime.ts). DOM over the deck, in
 * the VS Code panel only, never in the student file.
 */

export interface PanelJoint {
  name: string
  /** the slider's ends: the joint's limits, rounded inward to two decimals */
  min: number
  max: number
  /** the joint's value now (its setpoint) */
  get(): number
  /** move the joint there */
  set(value: number): void
  /** P writes this joint (marked) */
  moved(): boolean
}

/**
 * What the sliders show: the joints of the slide shown, and why they can't be
 * moved, if they can't (no robot, a trajectory). A new `key` (another slide
 * or scene) builds the sliders afresh.
 */
export interface PanelState {
  key: string
  joints: PanelJoint[]
  note?: string
}

export interface JointPanel {
  readonly open: boolean
  toggle(): void
  /** the line under the sliders: where P writes */
  setFooter(text: string): void
}

const format = (v: number) => `${v.toFixed(2)} rad · ${Math.round((v * 180) / Math.PI)}°`

/**
 * `read` gives what to show (asked every 150 ms while open); `top` where the
 * panel's top goes, below the panel's hint line.
 */
export function createJointPanel(read: () => PanelState, top: () => number): JointPanel {
  const box = document.createElement('div')
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', 'Joint sliders')
  box.style.cssText =
    'position:fixed;right:12px;top:44px;z-index:1001;width:min(320px,calc(100vw - 24px));max-height:calc(100vh - 120px);' +
    'overflow:auto;box-sizing:border-box;display:none;background:rgba(var(--surface-rgb),0.94);color:var(--text);' +
    'border:1px solid var(--border-soft);border-radius:10px;box-shadow:var(--shadow-text);font:13px/1.35 system-ui,sans-serif;' +
    'padding:8px 10px'
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px'
  const title = document.createElement('div')
  title.textContent = 'Joints'
  title.style.fontWeight = '600'
  const close = document.createElement('button')
  close.textContent = '×'
  close.title = 'Close (J)'
  close.setAttribute('aria-label', 'Close the joint sliders')
  close.style.cssText = 'background:none;border:none;color:var(--text-dim);font:18px/1 system-ui,sans-serif;cursor:pointer;padding:0 2px'
  close.addEventListener('click', () => toggle())
  // Space and Enter press the button; the deck would take Space as "next slide"
  close.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
  })
  head.append(title, close)
  const note = document.createElement('div')
  note.style.cssText = 'color:var(--text-dim);font-size:12px;margin:2px 0 6px'
  const list = document.createElement('div')
  const footer = document.createElement('div')
  footer.style.cssText = 'color:var(--text-dim);font-size:12px;margin-top:6px'
  box.append(head, note, list, footer)
  // a tap here isn't a tap on the slide (src/main.ts goes to the next slide on one)
  for (const type of ['pointerdown', 'pointerup'] as const) box.addEventListener(type, (e) => e.stopPropagation())
  document.addEventListener('DOMContentLoaded', () => document.body.append(box))
  if (document.readyState !== 'loading') document.body.append(box)

  let key: string | null = null
  let rows: Array<{ joint: PanelJoint; input: HTMLInputElement; name: HTMLElement; value: HTMLElement }> = []
  let posable = false
  /** the slider held with the pointer: it shows where the pointer is, not the joint */
  let held: HTMLInputElement | null = null
  let timer: number | undefined
  window.addEventListener('pointerup', () => (held = null), true)

  function build(state: PanelState): void {
    key = state.key
    note.textContent = state.note ?? ''
    note.style.display = state.note ? 'block' : 'none'
    // where P writes, only where it can
    posable = state.note === undefined
    footer.style.display = posable ? 'block' : 'none'
    rows = state.joints.map((joint) => {
      const row = document.createElement('div')
      row.style.cssText = 'display:grid;grid-template-columns:5.5em 1fr;column-gap:8px;align-items:center;margin:3px 0'
      const name = document.createElement('span')
      name.textContent = joint.name
      name.setAttribute('aria-hidden', 'true')
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(joint.min)
      input.max = String(joint.max)
      input.step = '0.01'
      input.disabled = state.note !== undefined
      input.setAttribute('aria-label', joint.name)
      input.style.cssText = 'width:100%;margin:0;accent-color:var(--accent)'
      const value = document.createElement('span')
      value.setAttribute('aria-hidden', 'true')
      value.style.cssText = 'grid-column:2;color:var(--text-dim);font-size:11px;font-variant-numeric:tabular-nums'
      input.addEventListener('pointerdown', () => (held = input))
      input.addEventListener('input', () => {
        const v = Number(input.value)
        joint.set(v)
        show(input, value, v)
      })
      row.append(name, input, value)
      return { joint, input, name, value }
    })
    list.replaceChildren(...rows.map((r) => r.input.parentElement!))
  }

  /** follow the joints: they move by other means too (the slide's own sliders, another slide) */
  function sync(): void {
    const state = read()
    if (state.key !== key) build(state)
    const at = top()
    box.style.top = `${at}px`
    box.style.maxHeight = `calc(100vh - ${at + 76}px)`
    for (const { joint, input, name, value } of rows) {
      // the joints P writes are marked
      const moved = posable && joint.moved()
      name.style.color = moved ? 'var(--accent)' : ''
      name.title = moved ? 'P saves this joint' : ''
      if (input === held) continue
      const v = joint.get()
      input.value = String(Math.min(Math.max(v, joint.min), joint.max))
      show(input, value, v)
    }
  }

  function show(input: HTMLInputElement, value: HTMLElement, v: number): void {
    value.textContent = format(v)
    input.setAttribute('aria-valuetext', format(v))
  }

  function toggle(): void {
    const opening = box.style.display === 'none'
    box.style.display = opening ? 'block' : 'none'
    window.clearInterval(timer)
    if (opening) {
      key = null
      sync()
      timer = window.setInterval(sync, 150)
    }
  }

  return {
    get open() {
      return box.style.display !== 'none'
    },
    toggle,
    setFooter(text: string) {
      footer.textContent = text
    },
  }
}
