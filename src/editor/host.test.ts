import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHost } from './host'

describe('createHost', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** a host whose extension answers each request with `answer` */
  function hostAnswering(answer: (message: Record<string, unknown>) => Record<string, unknown> | null) {
    vi.stubGlobal('window', globalThis)
    const sent: Array<Record<string, unknown>> = []
    const host = createHost((message) => {
      sent.push(message)
      const reply = answer(message)
      if (reply) queueMicrotask(() => host.onReply({ type: 'lysark:reply', id: message.id, ...reply }))
    }, 3)
    return { host, sent }
  }

  it('numbers requests from the page number, so another page can not answer them', () => {
    const { host, sent } = hostAnswering(() => ({ files: {} }))
    void host.read(['a.png'], 'bytes')
    expect(sent[0].id).toBe(3_000_001)
  })

  it('asks again for files answered later, and stops when nothing is answered', async () => {
    const { host, sent } = hostAnswering((message) => {
      const paths = message.paths as string[]
      // the first file of each request is answered, the rest are too much together
      return { files: Object.fromEntries(paths.map((p, i) => [p, i === 0 ? { base64: p } : { later: true }])) }
    })
    const files = await host.read(['a', 'b', 'c'], 'bytes')
    expect(files).toEqual({ a: { base64: 'a' }, b: { base64: 'b' }, c: { base64: 'c' } })
    expect(sent.map((m) => m.paths)).toEqual([['a', 'b', 'c'], ['b', 'c'], ['c']])

    const stuck = hostAnswering((message) => ({ files: Object.fromEntries((message.paths as string[]).map((p) => [p, { later: true }])) }))
    expect(await stuck.host.read(['x', 'y'], 'bytes')).toEqual({ x: { error: 'no answer for this file' }, y: { error: 'no answer for this file' } })
    expect(stuck.sent).toHaveLength(1)
  })

  it('asks for at most 32 files at a time', async () => {
    const { host, sent } = hostAnswering((message) => ({
      files: Object.fromEntries((message.paths as string[]).map((p) => [p, { base64: p }])),
    }))
    const paths = Array.from({ length: 70 }, (_, i) => `f${i}.png`)
    expect(Object.keys(await host.read(paths, 'bytes'))).toHaveLength(70)
    expect(sent.map((m) => (m.paths as string[]).length)).toEqual([32, 32, 6])
  })
})
