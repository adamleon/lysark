import { describe, expect, it } from 'vitest'
import { FrameLoop, MAX_REPORTED, type FrameLoopOptions } from './frame-loop'

/**
 * A loop on a fake clock: frames run only when the test calls `frame()`,
 * which runs the one asked for (a browser asks for one at a time).
 */
function setup(options: Pick<FrameLoopOptions, 'frame' | 'more'>) {
  let asked: ((now: number) => void) | null = null
  let requests = 0
  let clock = 1000
  const reported: unknown[] = []
  const loop = new FrameLoop({
    ...options,
    requestFrame: (callback) => {
      if (asked) throw new Error('a second frame asked for before the first ran')
      asked = callback
      requests++
    },
    now: () => clock,
    report: (error) => reported.push(error),
  })
  /** the frame asked for runs, 16 ms on; false if none was asked for */
  const frame = (): boolean => {
    const callback = asked
    if (!callback) return false
    asked = null
    clock += 16
    callback(clock)
    return true
  }
  return { loop, frame, reported, requests: () => requests, waiting: () => asked !== null }
}

describe('FrameLoop', () => {
  it('runs frames while more() says so, then stops entirely until started again (§3)', () => {
    let left = 3
    const dts: number[] = []
    const { loop, frame, requests, waiting } = setup({ frame: (_now, dt) => dts.push(dt), more: () => --left > 0 })
    loop.start()
    loop.start() // already running: no second frame asked for
    expect(requests()).toBe(1)
    while (frame());
    expect(dts).toEqual([0.016, 0.016, 0.016])
    expect(loop.running).toBe(false)
    expect(waiting()).toBe(false)
    left = 1
    loop.start()
    expect(loop.running).toBe(true)
    expect(frame()).toBe(true)
    expect(loop.running).toBe(false)
  })

  it('goes on after a frame throws, reporting each distinct error once', () => {
    let n = 0
    const { loop, frame, reported } = setup({
      frame: () => {
        n++
        if (n >= 2 && n <= 5) throw new TypeError("Cannot read properties of undefined (reading 'toFixed')")
        if (n === 6) throw new RangeError('another')
      },
      more: () => n < 10,
    })
    loop.start()
    while (frame());
    expect(n).toBe(10) // every frame ran: the loop never froze
    expect(reported.map((e) => (e as Error).message)).toEqual(["Cannot read properties of undefined (reading 'toFixed')", 'another'])
    expect(loop.running).toBe(false)
  })

  it('stops on a settled slide even when its frames throw, and starts again', () => {
    let settled = false
    const { loop, frame, reported } = setup({
      frame: () => {
        throw new Error('bad label')
      },
      more: () => !settled,
    })
    loop.start()
    frame()
    frame()
    settled = true
    expect(frame()).toBe(true)
    expect(loop.running).toBe(false)
    expect(frame()).toBe(false)
    loop.start()
    expect(loop.running).toBe(true)
    expect(reported).toHaveLength(1)
  })

  it('measures the time from the last frame, also across one that threw', () => {
    const dts: number[] = []
    let n = 0
    const { loop, frame } = setup({
      frame: (_now, dt) => {
        dts.push(dt)
        if (++n === 1) throw new Error('first')
      },
      more: () => n < 3,
    })
    loop.start()
    while (frame());
    expect(dts).toEqual([0.016, 0.016, 0.016])
  })

  it('stops, saying why, if more() itself throws', () => {
    const { loop, frame, reported } = setup({
      frame: () => undefined,
      more: () => {
        throw new Error('no scene manager')
      },
    })
    loop.start()
    frame()
    expect(loop.running).toBe(false)
    expect((reported[0] as Error).message).toBe('no scene manager')
  })

  it('goes on after a frame throws something that has no message', () => {
    let n = 0
    const odd = Object.create(null) // String() throws on it
    const { loop, frame, reported } = setup({
      frame: () => {
        n++
        if (n === 1) throw odd
        if (n === 2)
          throw {
            toString() {
              throw new Error('no message either')
            },
          }
      },
      more: () => n < 4,
    })
    loop.start()
    while (frame());
    expect(n).toBe(4)
    expect(reported).toHaveLength(1) // neither has a message: one report
    expect(reported[0]).toBe(odd)
    expect(loop.running).toBe(false)
  })

  it(`reports at most ${MAX_REPORTED} distinct errors`, () => {
    let n = 0
    const { loop, frame, reported } = setup({
      frame: () => {
        throw new Error(`frame ${++n}`)
      },
      more: () => n < 100,
    })
    loop.start()
    while (frame());
    expect(n).toBe(100)
    expect(reported).toHaveLength(MAX_REPORTED)
  })
})
