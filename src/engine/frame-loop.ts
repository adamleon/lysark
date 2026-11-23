/**
 * The deck's frame loop (spec §3). `frame` runs once per animation frame;
 * after each frame `more` says whether another is needed, and when it isn't
 * the loop stops entirely (no requestAnimationFrame at all) until start() is
 * called again, as any interaction or slide change does.
 *
 * An exception in a frame doesn't stop the loop: the next frame is asked for
 * as usual, and the exception is reported as an uncaught one would be, once
 * per distinct message. So one bad frame doesn't freeze the rest of the
 * lecture, and an error thrown on every frame of a slide doesn't flood the
 * console.
 */
export interface FrameLoopOptions {
  /** one frame's work; `dt` is the time since the last frame, in seconds */
  frame(now: number, dt: number): void
  /** after each frame, also one that threw: whether to ask for another */
  more(): boolean
  /** the browser's requestAnimationFrame, performance.now and reportError unless given (tests) */
  requestFrame?: (callback: (now: number) => void) => void
  now?: () => number
  report?: (error: unknown) => void
}

/** distinct errors reported at most: an error whose message changes every frame would flood the console */
export const MAX_REPORTED = 20

export class FrameLoop {
  private ticking = false
  private last = 0
  private readonly reported = new Set<string>()
  private readonly requestFrame: (callback: (now: number) => void) => void
  private readonly now: () => number
  private readonly report: (error: unknown) => void

  constructor(private readonly opts: FrameLoopOptions) {
    this.requestFrame = opts.requestFrame ?? ((callback) => requestAnimationFrame(callback))
    this.now = opts.now ?? (() => performance.now())
    this.report = opts.report ?? reportUncaught
  }

  /** a frame is asked for: the loop runs */
  get running(): boolean {
    return this.ticking
  }

  /** start the loop, if it has stopped */
  start(): void {
    if (this.ticking) return
    this.ticking = true
    this.last = this.now()
    this.requestFrame(this.tick)
  }

  private readonly tick = (now: number): void => {
    const dt = (now - this.last) / 1000
    this.last = now
    try {
      this.opts.frame(now, dt)
    } catch (error) {
      this.reportOnce(error)
    }
    let more: boolean
    try {
      more = this.opts.more()
    } catch (error) {
      // can't tell whether frames are needed: stop, and the next interaction starts it again
      this.reportOnce(error)
      more = false
    }
    if (more) this.requestFrame(this.tick)
    else this.ticking = false
  }

  private reportOnce(error: unknown): void {
    const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    if (this.reported.has(key) || this.reported.size >= MAX_REPORTED) return
    this.reported.add(key)
    this.report(error)
  }
}

/**
 * As the browser reports an uncaught exception: in the console, and to the
 * page's error listeners (the editor panel passes it on to VS Code, and
 * `lysark check` fails on it).
 */
function reportUncaught(error: unknown): void {
  if (typeof reportError === 'function') reportError(error)
  else console.error(error)
}
