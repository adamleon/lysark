export interface ToggleOptions {
  /** the two choices, index 0 shown solid by default */
  labels: [string, string]
  /** optional caption above the button */
  heading?: string
  /** called with the index now shown SOLID (0 or 1), including once on create */
  onToggle: (solidIndex: number) => void
}

export interface ToggleHandle {
  el: HTMLElement
}

/**
 * Two-state toggle button for the comparison slide: flips which overlaid robot
 * is solid. Syncs the scene to its initial state on creation so the button label
 * and the 3D materials never disagree after a slide revisit.
 */
export function createToggle(opts: ToggleOptions): ToggleHandle {
  const el = document.createElement('div')
  el.className = 'widget-toggle'

  if (opts.heading) {
    const cap = document.createElement('span')
    cap.className = 'widget-toggle-caption'
    cap.textContent = opts.heading
    el.appendChild(cap)
  }

  let solid = 0
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'widget-toggle-btn'
  const render = (): void => {
    btn.textContent = `Fremhevet: ${opts.labels[solid]}`
  }
  btn.addEventListener('click', () => {
    solid = solid === 0 ? 1 : 0
    render()
    opts.onToggle(solid)
  })
  render()
  opts.onToggle(solid) // sync the scene to the initial (solid = 0) state

  el.appendChild(btn)
  return { el }
}
