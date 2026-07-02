export interface SliderOptions {
  label: string
  min: number
  max: number
  step?: number
  value: number
  format?: (v: number) => string
  onInput: (v: number) => void
}

export interface Slider {
  el: HTMLElement
  set(v: number): void
}

export function createSlider(opts: SliderOptions): Slider {
  const el = document.createElement('div')
  el.className = 'widget-slider'
  el.dataset.label = opts.label

  const label = document.createElement('label')
  label.textContent = opts.label

  const out = document.createElement('output')
  const fmt = opts.format ?? ((v: number) => v.toFixed(2))
  out.textContent = fmt(opts.value)

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(opts.min)
  input.max = String(opts.max)
  input.step = String(opts.step ?? 0.001)
  input.value = String(opts.value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    out.textContent = fmt(v)
    opts.onInput(v)
  })

  el.append(label, out, input)
  return {
    el,
    set(v) {
      input.value = String(v)
      out.textContent = fmt(v)
    },
  }
}
