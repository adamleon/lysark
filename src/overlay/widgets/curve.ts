import uPlot from 'uplot'
import { PROFILES, type ProfileName } from '../../engine/time-scaling'
import { themeColor } from '../../theme'

/**
 * Static profile plot (trajectory-planning lecture): draws a time-scaling's
 * position s, velocity ṡ, and acceleration s̈ over the normalized domain
 * τ ∈ [0,1]. Unlike the live `plot` widget it binds to no channel — the curves
 * are analytic, so the cubic's nonzero-endpoint acceleration and the quintic's
 * zero-endpoint acceleration sit side by side. A marker, redrawn each frame at
 * the robot's live phase, ties the plot to the motion on screen.
 *
 * Each series is normalized to unit peak so the three shapes are comparable on
 * one axis — the lesson is derivative CONTINUITY (where a curve rests at the
 * ends), not absolute magnitude.
 */

const HEIGHT = 210
const N = 121

type Series = 's' | 'v' | 'a'

const SERIES: Record<Series, { token: string; label: string }> = {
  s: { token: '--accent', label: 's(t)' }, // position — red
  v: { token: '--plot-v', label: 'ṡ(t)' }, // velocity — green
  a: { token: '--cheese', label: 's̈(t)' }, // acceleration — gold
}

export interface CurveOptions {
  label: string
  profile: ProfileName
  show: Series[]
  /** current normalized phase 0..1, sampled once per frame for the marker */
  phase: () => number
}

export interface CurveHandle {
  el: HTMLElement
  onFrame(t: number): void
  dispose(): void
}

export function createCurve(opts: CurveOptions): CurveHandle {
  // colours come from the theme tokens (src/theme.ts), read when the plot is made
  const AXIS = themeColor('--plot-axis')
  const GRID = themeColor('--plot-grid')
  const seriesColor = (key: Series) => themeColor(SERIES[key].token)
  const el = document.createElement('div')
  el.className = 'slide-plot curve-plot'

  const legend = document.createElement('div')
  legend.className = 'curve-legend'
  for (const key of opts.show) {
    const item = document.createElement('span')
    item.className = 'curve-legend-item'
    const dot = document.createElement('i')
    dot.style.background = seriesColor(key)
    item.append(dot, document.createTextNode(SERIES[key].label))
    legend.appendChild(item)
  }
  el.appendChild(legend)

  const host = document.createElement('div')
  host.className = 'plot-host'
  el.appendChild(host)

  // precompute the normalized curves once, over τ ∈ [0,1] at T = 1
  const prof = PROFILES[opts.profile]
  const xs: number[] = []
  const raw: Record<Series, number[]> = { s: [], v: [], a: [] }
  for (let i = 0; i < N; i++) {
    const tau = i / (N - 1)
    const smp = prof(tau, 1)
    xs.push(tau)
    raw.s.push(smp.s)
    raw.v.push(smp.v)
    raw.a.push(smp.a)
  }
  const normalize = (arr: number[]): number[] => {
    const peak = Math.max(1e-9, ...arr.map((y) => Math.abs(y)))
    return arr.map((y) => y / peak)
  }

  const data: number[][] = [xs]
  const series: uPlot.Series[] = [{}]
  for (const key of opts.show) {
    data.push(normalize(raw[key]))
    series.push({ stroke: seriesColor(key), width: 2, points: { show: false } })
  }

  // marker: a DOM line in uPlot's `over` layer (which covers the plot area
  // exactly), positioned each frame by valToPos — no canvas redraw needed
  const marker = document.createElement('div')
  marker.className = 'curve-marker'

  let plot: uPlot | null = null
  const init = (): void => {
    const width = host.clientWidth || el.clientWidth
    if (width === 0) return // not laid out yet
    // in the `graph` layout CSS gives the host a tall flex height; elsewhere it
    // has none, so fall back to the compact default
    const height = host.clientHeight || HEIGHT
    plot = new uPlot(
      {
        width,
        height,
        title: opts.label,
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
