import type { PidChannel } from './motion-system'

/**
 * Plot binding resolution (spec §7/§8): a plot binds to a channel and,
 * optionally, one of its derived scalars. `joint2` → measured value,
 * `joint2.setpoint` → target, `joint2.error` → setpoint − measured.
 */
export type ChannelField = 'measured' | 'setpoint' | 'error'

const FIELDS: readonly string[] = ['measured', 'setpoint', 'error']

export interface ParsedBinding {
  channel: string
  field: ChannelField
}

export function parseBinding(bind: string): ParsedBinding {
  const dot = bind.indexOf('.')
  if (dot === -1) return { channel: bind, field: 'measured' }
  const field = bind.slice(dot + 1)
  if (FIELDS.includes(field)) {
    return { channel: bind.slice(0, dot), field: field as ChannelField }
  }
  // unrecognized suffix: treat the whole string as the channel name so the
  // runtime warns on an unknown channel rather than silently reading measured
  return { channel: bind, field: 'measured' }
}

export function readField(channel: PidChannel, field: ChannelField): number {
  switch (field) {
    case 'setpoint':
      return channel.setpoint
    case 'error':
      return channel.error()
    default:
      return channel.x
  }
}
