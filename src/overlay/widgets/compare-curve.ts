import uPlot from 'uplot'
import { PROFILES, type ProfileName, type TimeScaling } from '../../engine/time-scaling'

/**
 * Comparison plot (trajectory-planning lecture): one selectable quantity —
 * position s, velocity ṡ or acceleration s̈ — drawn for TWO time-scaling profiles
 * at once over normalized time τ ∈ [0,1], on a shared scale so the shapes are
 * directly comparable (e.g. the cubic's straight, nonzero-endpoint acceleration
 * against the quintic's zero-endpoint bump). A marker tracks the robots' live
 * time; tabs switch the quantity.
 */

const AXIS = '#8b9096'
const GRID = 'rgba(255, 255, 255, 0.07)'
const HEIGHT = 150
const N = 121
const COLORS = ['#e0574f', '#3fc46a'] // profile 0, profile 1 (green matches the ghost)

type Series = 's' | 'v' | 'a'
const QNAME: Record<Series, string> = { s: 'posisjon', v: 'hastighet', a: 'akselerasjon' }

export interface CompareOptions {
  profiles: [ProfileName, ProfileName]
  labels: [string, string]
  quantities: Series[]
  /** current normalized time 0..1, for the marker */
  phase: () => number
}

export interface CompareHandle {
  el: HTMLElement
  onFrame(): void
  dispose(): void
}

function sample(prof: TimeScaling, q: Series, t: number): number {
  const smp = prof(t, 1)
  return q === 's' ? smp.s : q === 'v' ? smp.v : smp.a
}

export function createCompare(opts: CompareOptions): CompareHandle {
  const el = document.createElement('div')
  el.className = 'slide-plot compare-plot'

  const title = document.createElement('div')
  title.className = 'compare-title'
  el.appendChild(title)

  const legend = document.createElement('div')
  legend.className = 'curve-legend'
  opts.labels.forEach((lab, i) => {
    const item = document.createElement('span')
    item.className = 'curve-legend-item'
    const dot = document.createElement('i')
    dot.style.background = COLORS[i]
    item.append(dot, document.createTextNode(lab))
    legend.appendChild(item)
  })
  el.appendChild(legend)

  const tabs = document.createElement('div')
  tabs.className = 'compare-tabs'
  el.appendChild(tabs)

  const host = document.createElement('div')
  el.appendChild(host)

  const xs: number[] = []
  for (let i = 0; i < N; i++) xs.push(i / (N - 1))

  // precompute each quantity for both profiles, shared-normalized so the two
  // curves sit on one honest scale
  const dataByQ = {} as Record<Series, number[][]>
  for (const q of opts.quantities) {
    const a = xs.map((t) => sample(PROFILES[opts.profiles[0]], q, t))
    const b = xs.map((t) => sample(PROFILES[opts.profiles[1]], q, t))
    const peak = Math.max(1e-9, ...a.map((y) => Math.abs(y)), ...b.map((y) => Math.abs(y)))
    dataByQ[q] = [xs, a.map((y) => y / peak), b.map((y) => y / peak)]
  }

  let current: Series = opts.quantities[0]
  const marker = document.createElement('div')
  marker.className = 'curve-marker'
  let plot: uPlot | null = null

  const setQuantity = (q: Series): void => {
    current = q
    title.textContent = `${QNAME[q]} vs. tid`
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.q === q))
    if (plot) plot.setData(dataByQ[q] as uPlot.AlignedData)
  }

  for (const q of opts.quantities) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'compare-tab'
    b.dataset.q = q
    b.textContent = QNAME[q]
    b.classList.toggle('active', q === current)
    b.addEventListener('click', () => setQuantity(q))
    tabs.appendChild(b)
  }
  title.textContent = `${QNAME[current]} vs. tid`

  const init = (): void => {
    const width = host.clientWidth || el.clientWidth
    if (width === 0) return
    plot = new uPlot(
      {
        width,
        height: HEIGHT,
        cursor: { show: false },
        legend: { show: false },
        scales: { x: { time: false, range: [0, 1] }, y: { range: [-1.08, 1.08] } },
        axes: [
          {
            stroke: AXIS,
            grid: { stroke: GRID, width: 1 },
            ticks: { stroke: GRID },
            size: 26,
            font: '11px system-ui',
            values: (_u, ticks) => ticks.map((t) => t.toFixed(1)),
          },
          { show: false },
        ],
        series: [
          {},
          { stroke: COLORS[0], width: 2, points: { show: false } },
          { stroke: COLORS[1], width: 2, points: { show: false } },
        ],
      },
      dataByQ[current] as uPlot.AlignedData,
      host,
    )
    plot.over.appendChild(marker)
  }

  return {
    el,
    onFrame() {
      if (!plot) {
        init()
        if (!plot) return
      }
      const p = Math.min(Math.max(opts.phase(), 0), 1)
      marker.style.left = `${plot.valToPos(p, 'x')}px`
    },
    dispose() {
      plot?.destroy()
      plot = null
    },
  }
}
