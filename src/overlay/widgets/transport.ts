export interface TransportOptions {
  label?: string
  isRunning: () => boolean
  setRunning: (running: boolean) => void
  /** current normalized time 0..1 */
  getTime: () => number
  /** scrub to a normalized time (also pauses) */
  setTime: (u: number) => void
}

export interface TransportHandle {
  el: HTMLElement
  onFrame(): void
}

/**
 * Transport for a `control: time` trajectory: a Run/Pause button and a
 * normalized-time slider. While running the slider follows the motion; grabbing
 * it pauses and scrubs. The graph marker and both robots read the same time, so
 * everything stays in lockstep.
 */
export function createTransport(opts: TransportOptions): TransportHandle {
  const el = document.createElement('div')
  el.className = 'widget-transport'

  if (opts.label) {
    const cap = document.createElement('span')
    cap.className = 'widget-toggle-caption'
    cap.textContent = opts.label
    el.appendChild(cap)
  }

  const row = document.createElement('div')
  row.className = 'transport-row'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'transport-btn'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '1'
  slider.step = '0.002'
  slider.className = 'transport-slider'

  const readout = document.createElement('output')
  readout.className = 'transport-readout'

  const renderBtn = (): void => {
    btn.textContent = opts.isRunning() ? '❚❚ Pause' : '▶ Kjør'
  }
  btn.addEventListener('click', () => {
    opts.setRunning(!opts.isRunning())
    renderBtn()
  })
  slider.addEventListener('input', () => {
    const u = Number(slider.value)
    opts.setTime(u) // pauses
    readout.textContent = u.toFixed(2)
    renderBtn()
  })

  renderBtn()
  readout.textContent = opts.getTime().toFixed(2)
  row.append(btn, slider)
  el.append(row, readout)

  return {
    el,
    onFrame() {
      // while running, mirror the live time onto the slider + readout
      if (opts.isRunning()) {
        const u = opts.getTime()
        slider.value = String(u)
        readout.textContent = u.toFixed(2)
      }
      renderBtn()
    },
  }
}
