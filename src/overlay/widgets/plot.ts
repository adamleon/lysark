import uPlot from 'uplot'

export interface PlotOptions {
  label: string
  /** fixed y-axis range; auto-scales when omitted */
  range?: [number, number]
  /** seconds of history kept in the scrolling window */
  window: number
  /** live value source, sampled once per frame */
  sample: () => number
}

export interface PlotHandle {
  el: HTMLElement
  /** push one sample at time t (seconds) and redraw */
  onFrame(t: number): void
  dispose(): void
}

const PLOT_HEIGHT = 160
const ACCENT = '#ff3b3b'
const AXIS = '#8b9096'
const GRID = 'rgba(255, 255, 255, 0.07)'

/**
 * Live channel plot (spec §8, §12): uPlot renders to its OWN 2D canvas in the
 * DOM overlay — never inside the WebGL scene. A ring buffer holds the last
 * `window` seconds; the x-scale follows the newest sample so the trace scrolls.
 */
export function createPlot(opts: PlotOptions): PlotHandle {
  const el = document.createElement('div')
  el.className = 'slide-plot'

  let plot: uPlot | null = null
  const xs: number[] = []
  const ys: number[] = []

  const init = (): void => {
    const width = el.clientWidth
    if (width === 0) return // not laid out yet — wait for a frame with a real size
    plot = new uPlot(
      {
        width,
        height: PLOT_HEIGHT,
        title: opts.label,
        cursor: { show: false },
        legend: { show: false },
        scales: {
          x: { time: false, range: (_u, _min, max) => [max - opts.window, max] },
          y: opts.range ? { range: [opts.range[0], opts.range[1]] } : {},
        },
        axes: [
          { stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, size: 28, font: '11px system-ui' },
          { stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID }, size: 34, font: '11px system-ui' },
        ],
        series: [{}, { stroke: ACCENT, width: 2, points: { show: false } }],
      },
      [xs, ys],
      el,
    )
  }

  return {
    el,
    onFrame(t) {
      if (!plot) {
        init()
        if (!plot) return
      }
      xs.push(t)
      ys.push(opts.sample())
      // drop samples that have scrolled off the window (keep a small margin)
      const cutoff = t - opts.window * 1.15
      while (xs.length > 2 && xs[0] < cutoff) {
        xs.shift()
        ys.shift()
      }
      plot.setData([xs, ys])
    },
    dispose() {
      plot?.destroy()
      plot = null
    },
  }
}
