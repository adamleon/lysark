import { describe, expect, it } from 'vitest'
import { parseBinding, readField } from './channel-binding'
import { PidChannel } from './motion-system'
import { PID } from './pid'

describe('parseBinding', () => {
  it('defaults a bare channel to the measured field', () => {
    expect(parseBinding('joint2')).toEqual({ channel: 'joint2', field: 'measured' })
  })

  it('splits a known derived-field suffix', () => {
    expect(parseBinding('joint2.error')).toEqual({ channel: 'joint2', field: 'error' })
    expect(parseBinding('swing.setpoint')).toEqual({ channel: 'swing', field: 'setpoint' })
    expect(parseBinding('j.measured')).toEqual({ channel: 'j', field: 'measured' })
  })

  it('treats an unknown suffix as part of the channel name (runtime warns)', () => {
    expect(parseBinding('joint2.velocity')).toEqual({ channel: 'joint2.velocity', field: 'measured' })
  })
})

describe('readField', () => {
  it('reads measured (x), setpoint, and error off a live channel', () => {
    const ch = new PidChannel({ x0: 1, pid: new PID({ kp: 1, ki: 0, kd: 0, outMin: -1, outMax: 1 }) })
    ch.setpoint = 2
    expect(readField(ch, 'measured')).toBe(1)
    expect(readField(ch, 'setpoint')).toBe(2)
    expect(readField(ch, 'error')).toBe(1) // setpoint − measured
  })
})
