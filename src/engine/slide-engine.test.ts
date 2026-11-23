import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Overlay } from '../overlay/overlay'
import { PidChannel } from './motion-system'
import { PID } from './pid'
import type { SceneManager } from './scene-manager'
import type { SceneInstance } from './scene-types'
import { SlideEngine } from './slide-engine'
import type { CompiledSlide, WidgetSpec } from './slide-types'

const GAINS = { kp: 12, ki: 0, kd: 2.5 }

function channel(): PidChannel {
  return new PidChannel({ x0: 0, pid: new PID({ ...GAINS, outMin: -50, outMax: 50 }) })
}

/** an arm with two joints, joint1 set by the scene's defaults */
function arm(): SceneInstance {
  return {
    root: null as never,
    anchors: {},
    channels: { joint1: channel(), joint2: channel() },
    defaults: { joints: { joint1: 0.1 } },
    defaultGains: { joint1: { ...GAINS }, joint2: { ...GAINS } },
    serialize: () => null,
    restore: () => undefined,
    dispose: () => undefined,
  }
}

function slide(joints: Record<string, number>, widgets: WidgetSpec[] = []): CompiledSlide {
  return { id: 'probe', title: 'probe', scene: 'arm', layout: 'panel', effective: { joints }, widgets, anchored: [], fragments: ['x'] }
}

/** enter a deck of the one slide on `scene`; resolves once the slide's targets are applied and it shows */
async function enter(s: CompiledSlide, scene: SceneInstance): Promise<void> {
  vi.stubGlobal('window', { location: { hash: '' } })
  let shown!: () => void
  const done = new Promise<void>((resolve) => (shown = resolve))
  const engine = new SlideEngine({
    slides: [s],
    scenes: { transitionTo: async () => ({ binding: scene, boundary: true }) } as unknown as SceneManager,
    overlay: { show: () => shown(), setVisibleChunks: () => undefined } as unknown as Overlay,
    overlayCtx: { createWidget: () => null },
    applyCamera: () => undefined,
  })
  engine.start(0)
  await done
}

const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // what the bug wrote onto JavaScript's own objects, so one failing test doesn't spoil the next
  delete (Object as unknown as Record<string, unknown>).setpoint
  delete (Object.prototype as unknown as Record<string, unknown>).setpoint
})

describe('SlideEngine: a slide\'s joints and its sliders\' gains', () => {
  it('puts the scene defaults, then the slide\'s joints, on the channels', async () => {
    const scene = arm()
    await enter(slide({ joint2: -0.3 }), scene)
    expect(scene.channels.joint1.setpoint).toBe(0.1)
    expect(scene.channels.joint2.setpoint).toBe(-0.3)
  })

  it('warns about a joint name every JavaScript object has, and writes nothing onto Object', async () => {
    for (const name of NAMES) {
      const scene = arm()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // as the slide's YAML gives it: an own key, also for __proto__
      const joints = JSON.parse(`{ "${name}": 0.5, "joint2": -0.3 }`) as Record<string, number>
      await enter(slide(joints), scene)
      expect(warn).toHaveBeenCalledWith(`slide 'probe': unknown joint channel '${name}'`)
      expect((Object as unknown as Record<string, unknown>).setpoint).toBeUndefined()
      expect(({} as Record<string, unknown>).setpoint).toBeUndefined()
      expect(scene.channels.joint2.setpoint).toBe(-0.3)
      vi.restoreAllMocks()
    }
  })

  it("sets a slider's gains on its joint, and ignores a slider bound to a name every JavaScript object has", async () => {
    for (const name of NAMES) {
      const scene = arm()
      const widgets: WidgetSpec[] = [
        { type: 'slider', bind: name, pid: { kp: 3 } },
        { type: 'slider', bind: 'joint2', pid: { kd: 0.5 } },
      ]
      await enter(slide({}, widgets), scene)
      expect(scene.channels.joint1.pid.kp).toBe(GAINS.kp)
      expect(scene.channels.joint2.pid.kd).toBe(0.5)
    }
  })
})
