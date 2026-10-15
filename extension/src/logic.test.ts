import { describe, expect, it } from 'vitest'
import { editorUrl, isCameraView, isCoursePackage, matchSlide, notificationText, singleEdit } from './logic'

describe('notificationText', () => {
  // VS Code's link parser for extension messages (workbench notifications)
  const LINK = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?:\s+"([^"]+)")?\)/gi

  it('leaves no text VS Code would turn into a link', () => {
    for (const text of [
      'version [Update](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22x%22%7D)',
      'outside https://x/: /[a](https://evil.example/)',
      '[a]  (file:///etc/passwd)',
    ]) {
      expect(notificationText(text).match(LINK), text).toBeNull()
    }
  })

  it('keeps ordinary text, brackets included', () => {
    expect(notificationText('lookAt: [0, 1, 2] (a point)')).toBe('lookAt: [0, 1, 2] (a point)')
  })
})

describe('matchSlide', () => {
  const deck = (...bodies: string[]) => bodies.map((b, i) => `---\nscene: arm\ncamera:\n  offset: [${i}, 1, 1]\n---\n${b}\n`).join('')

  it('keeps the number when the slides are the same, even if their frontmatter changed', () => {
    const before = deck('# A', '# B', '# C')
    expect(matchSlide(before, before, 1)).toBe(1)
    expect(matchSlide(before, before.replace('offset: [1, 1, 1]', 'offset: [9, 9, 9]'), 1)).toBe(1)
  })

  it('follows a slide when others are added, removed, or reordered', () => {
    const before = deck('# A', '# B', '# C')
    expect(matchSlide(before, deck('# New', '# A', '# B', '# C'), 2)).toBe(3)
    expect(matchSlide(before, deck('# B', '# C'), 2)).toBe(1)
    expect(matchSlide(before, deck('# C', '# A', '# B'), 0)).toBe(1)
  })

  it('tells same-looking slides apart by their id', () => {
    const before = '---\nid: one\n---\n# Same\n---\nid: two\n---\n# Same\n'
    const after = '---\nid: two\n---\n# Same\n---\nid: one\n---\n# Same\n'
    expect(matchSlide(before, after, 0)).toBe(1)
  })

  it('gives -1 when the slide itself changed or the text has no slides', () => {
    const before = deck('# A', '# B')
    expect(matchSlide(before, deck('# A', '# B, edited'), 1)).toBe(-1)
    expect(matchSlide(before, 'not slides', 0)).toBe(-1)
    expect(matchSlide(before, before + 'x', 5)).toBe(-1)
  })
})

describe('editorUrl', () => {
  it('adds _lysark/editor/ to the homepage, with or without a trailing slash', () => {
    const want = 'https://adamleon.github.io/ais2105-lectures/_lysark/editor/'
    expect(editorUrl('', { homepage: 'https://adamleon.github.io/ais2105-lectures/' })).toBe(want)
    expect(editorUrl('', { homepage: 'https://adamleon.github.io/ais2105-lectures' })).toBe(want)
  })

  it('prefers the setting, as a folder address', () => {
    expect(editorUrl(' http://localhost:4173/ ', { homepage: 'https://x.github.io/c/' })).toBe('http://localhost:4173/')
    expect(editorUrl('http://127.0.0.1:4173/_lysark/editor?x=1#y', null)).toBe('http://127.0.0.1:4173/_lysark/editor/')
  })

  it('refuses characters that would break the panel security policy', () => {
    expect(() => editorUrl('https://x.github.io/a;b/', null)).toThrow(/character/)
    expect(() => editorUrl('', { homepage: 'https://x.github.io/a,b' })).toThrow(/character/)
  })

  it('explains a missing or unusable address', () => {
    expect(() => editorUrl('', {})).toThrow(/no "homepage"/)
    expect(() => editorUrl('', null)).toThrow(/no "homepage"/)
    expect(() => editorUrl('', { homepage: 'adamleon.github.io/c' })).toThrow(/not a web address/)
    expect(() => editorUrl('', { homepage: 'http://adamleon.github.io/c/' })).toThrow(/https/)
    expect(() => editorUrl('file:///c:/x', {})).toThrow(/https/)
  })
})

describe('isCoursePackage', () => {
  it('is true only with the engine as a dependency', () => {
    expect(isCoursePackage({ dependencies: { lysark: 'github:adamleon/lysark#v2.1.0' } })).toBe(true)
    expect(isCoursePackage({ dependencies: { vite: '6' } })).toBe(false)
    expect(isCoursePackage({})).toBe(false)
    expect(isCoursePackage(null)).toBe(false)
  })
})

describe('isCameraView', () => {
  it('accepts a point or an anchor name, with an offset', () => {
    expect(isCameraView({ lookAt: [0, 0.5, 0], offset: [1, 2, 3] })).toBe(true)
    expect(isCameraView({ lookAt: 'tool', offset: [1, 2, 3] })).toBe(true)
  })
  it('refuses anything else', () => {
    expect(isCameraView({ lookAt: [0, 0.5], offset: [1, 2, 3] })).toBe(false)
    expect(isCameraView({ lookAt: [0, 0.5, 0], offset: [1, 2, NaN] })).toBe(false)
    expect(isCameraView({ lookAt: [0, 0.5, 0] })).toBe(false)
    expect(isCameraView(null)).toBe(false)
  })
})

describe('singleEdit', () => {
  const apply = (old: string, e: ReturnType<typeof singleEdit>) =>
    e ? old.slice(0, e.start) + e.text + old.slice(e.end) : old

  it('replaces only the changed part', () => {
    const old = 'camera:\n  offset: [1, 2, 3]\n---\n'
    const now = 'camera:\n  offset: [1.5, 2, 3]\n---\n'
    const e = singleEdit(old, now)
    expect(e).toEqual({ start: 20, end: 20, text: '.5' })
    expect(apply(old, e)).toBe(now)
  })

  it('handles insertions, deletions, repeated characters, and no change', () => {
    for (const [a, b] of [
      ['aaa', 'aaaa'],
      ['aaaa', 'aa'],
      ['x\n\ny', 'x\n  z\n\ny'],
      ['', 'abc'],
      ['abc', ''],
    ]) {
      expect(apply(a, singleEdit(a, b))).toBe(b)
    }
    expect(singleEdit('same', 'same')).toBeNull()
  })
})
