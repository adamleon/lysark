import { describe, expect, it } from 'vitest'
import { matchSlide, singleEdit } from './slide-match'

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

  it('tells same-looking slides apart by their frontmatter', () => {
    const tour = (...offsets: number[]) => offsets.map((o) => `---\nscene: arm\ncamera:\n  offset: [${o}, 1, 1]\n---\n## Tour\n`).join('')
    // a slide of the tour removed before it, one added after
    expect(matchSlide(tour(1, 2, 3), tour(2, 3, 4), 1)).toBe(0)
    // two slides with the same text in different scenes, swapped
    const arm = '---\nscene: arm\ncamera:\n  offset: [1, 1, 1]\n---\n## Tour\n'
    const agilus = '---\nscene: agilus\ncamera:\n  offset: [2, 1, 1]\n---\n## Tour\n'
    expect(matchSlide(arm + agilus, agilus + arm, 1)).toBe(0)
    // its camera edited too: the scene still tells them apart
    expect(matchSlide(arm + agilus, agilus.replace('[2, 1, 1]', '[5, 1, 1]') + arm, 1)).toBe(0)
    // the removed slide is not found as the one that took its place
    expect(matchSlide(tour(1, 2, 3), tour(2, 3, 4), 0)).toBe(-1)
  })

  it('keeps the order of identical slides, and gives -1 when it is unclear which is meant', () => {
    const same = (n: number) => '---\ncamera:\n  offset: [1, 1, 1]\n---\n'.repeat(n)
    const before = '---\n---\n# Title\n' + same(2)
    // a different slide added before them: the second is still the second
    expect(matchSlide(before, '---\n---\n# Title\n---\n---\n# New\n' + same(2), 2)).toBe(3)
    // one more exactly like them: unclear
    expect(matchSlide(before, '---\n---\n# Title\n' + same(3), 2)).toBe(-1)
  })

  it('gives -1 when the slide itself changed or the text has no slides', () => {
    const before = deck('# A', '# B')
    expect(matchSlide(before, deck('# A', '# B, edited'), 1)).toBe(-1)
    expect(matchSlide(before, 'not slides', 0)).toBe(-1)
    expect(matchSlide(before, before + 'x', 5)).toBe(-1)
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
