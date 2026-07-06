import uPlot from 'uplot'

/**
 * Joint-space plot for the PTP/Lin slides: each driven joint's value against the
 * path parameter s. The curves are precomputed from the trajectory — PTP (joint
 * space) yields straight lines, Lin (task space via IK) yields curved ones — so
 * this is the joint-space mirror of the traced tool paths. A marker tracks the
 * live s.
 */

const AXIS = '#8b9096'
const GRID = 'rgba(255, 255, 255, 0.07)'
// a touch shorter than the profile `curve` plots: the PTP/Lin slides this sits on
// carry more body text, so the plot is sized to keep the heading on-screen even on
// a short (720p) viewport.
const HEIGHT = 178
const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b']

export interface JointSeries {
  label: string
  values: number[]
}

export interface JointGraphOptions {
  label: string
  /** x samples in [0,1] */
  s: number[]
  series: JointSeries[]
  /** current s ∈ [0,1] for the marker */
  phase: () => number
}

export interface JointGraphHandle {
  el: HTMLElement
  onFrame(): void
  dispose(): void
}

export function createJointGraph(opts: JointGraphOptions): JointGraphHandle {
  const el = document.createElement('div')
  el.className = 'slide-plot joints-plot'

  const title = document.createElement('div')
  title.className = 'compare-title'
  title.textContent = opts.label
  el.appendChild(title)

  const legend = document.createElement('div')
  legend.className = 'curve-legend'
  opts.series.forEach((serie, i) => {
    const item = document.createElement('span')
    item.className = 'curve-legend-item'
    const dot = document.createElement('i')
    dot.style.background = COLORS[i % COLORS.length]
    item.append(dot, document.createTextNode(serie.label))
    legend.appendChild(item)
  })
  el.appendChild(legend)

  const host = document.createElement('div')
  host.className = 'plot-host'
  el.appendChild(host)

  const data: number[][] = [opts.s, ...opts.series.map((serie) => serie.values)]
  const series: uPlot.Series[] = [
    {},
    ...opts.series.map((_, i) => ({ stroke: COLORS[i % COLORS.length], width: 2, points: { show: false } })),
  ]

  const marker = document.createElement('div')
  marker.className = 'curve-marker'
  let plot: uPlot | null = null

  const init = (): void => {
    const width = host.clientWidth || el.clientWidth
    if (width === 0) return
    const height = host.clientHeight || HEIGHT
    plot = new uPlot(
      {
        width,
        height,
        cursor: { show: false },
        legend: { show: false },
        scales: { x: { time: false, range: [0, 1] } },
        axes: [
          {
            stroke: AXIS,
            grid: { stroke: GRID, width: 1 },
            ticks: { stroke: GRID },
            size: 26,
            font: '11px system-ui',
            values: (_u, ticks) => ticks.map((t) => t.toFixed(1)),
          },
          { stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, size: 34, font: '11px system-ui' },
        ],
        series,
      },
      data as uPlot.AlignedData,
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
