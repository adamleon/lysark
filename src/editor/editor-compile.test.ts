import { describe, expect, it } from 'vitest'
import { compileForEditor, updateTargets } from './editor-compile'

const deck = (offset2: string, title1 = '# One') =>
  `---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n  offset: [1, 1, 1]\n---\n${title1}\n` +
  `---\nscene: arm\ncamera:\n  offset: ${offset2}\n---\n# Two\n` +
  `---\nscene: arm\n---\n# Three\n`

describe('compileForEditor', () => {
  const lecture = '---\n---\n![arm](images/arm.png)\n\n<img src="gone.png">\n'

  it('fills each image from the map by its src, and shows a placeholder for the rest', () => {
    const html = JSON.stringify(compileForEditor(lecture, { 'images/arm.png': 'data:image/png;base64,QUJD' }))
    expect(html).toContain('data:image/png;base64,QUJD')
    expect(html).toContain('image%20not%20shown')
    expect(html).toContain('gone.png')
    expect(html).not.toContain('lysark-image:')
  })

  it('shows placeholders without a map', () => {
    expect(JSON.stringify(compileForEditor(lecture))).not.toContain('base64')
  })
})

describe('updateTargets', () => {
  it('copies changed cameras into the running slides, carried forward as the compiler does', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    const changed = updateTargets(running, compileForEditor(deck('[3, 3, 3]')))
    expect(changed).toEqual([1, 2]) // slide 3 inherits slide 2's camera
    expect(running[1].effective.camera).toEqual({ lookAt: [0, 0.5, 0], offset: [3, 3, 3] })
    expect(running[2].effective.camera).toEqual({ lookAt: [0, 0.5, 0], offset: [3, 3, 3] })
  })

  it('changes nothing when only the cameras are the same', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    expect(updateTargets(running, compileForEditor(deck('[2, 2, 2]')))).toEqual([])
  })

  it('copies changed joints too, carried forward', () => {
    const withJoints = (q: string) => deck('[2, 2, 2]').replace('offset: [2, 2, 2]', `offset: [2, 2, 2]\njoints: { joint1: ${q} }`)
    const running = compileForEditor(withJoints('0.5'))
    expect(updateTargets(running, compileForEditor(withJoints('0.75')))).toEqual([1, 2])
    expect(running[1].effective.joints).toEqual({ joint1: 0.75 })
    expect(running[2].effective.joints).toEqual({ joint1: 0.75 })
    expect(running[0].effective.joints).toEqual({})
  })

  it("copies a trajectory's new ends (a pose it names changed), and nothing else of it", () => {
    const traj = (q: number, space = 'joint') =>
      `---\nscene: arm\ntrajectory:\n  control: slider\n  space: ${space}\n  from: { joint1: ${q} }\n  to: { joint1: 1 }\n---\n# T\n`
    const running = compileForEditor(traj(0))
    expect(updateTargets(running, compileForEditor(traj(0.5)))).toEqual([0])
    expect(running[0].trajectory!.from).toEqual({ joint1: 0.5 })
    expect(updateTargets(running, compileForEditor(traj(0.5, 'task')))).toBeNull()
  })

  it('refuses when anything besides cameras differs', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    const before = JSON.stringify(running)
    expect(updateTargets(running, compileForEditor(deck('[3, 3, 3]', '# One, edited')))).toBeNull()
    expect(updateTargets(running, compileForEditor(deck('[2, 2, 2]') + '---\n---\n# Four\n'))).toBeNull()
    expect(JSON.stringify(running)).toBe(before)
  })
})
