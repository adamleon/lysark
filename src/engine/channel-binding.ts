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

/**
 * The scene's channel by a name an author wrote (a slide's joints, a widget's
 * bind, idle, a trajectory, a live vector's rows): own keys only, so a name
 * that every JavaScript object has (constructor, toString, __proto__, …) finds
 * nothing and warns like any misspelled name, instead of finding Object's
 * member.
 */
export function channelNamed<T>(channels: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(channels, name) ? channels[name] : undefined
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
