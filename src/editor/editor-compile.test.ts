import { describe, expect, it } from 'vitest'
import { compileForEditor, updateCameras } from './editor-compile'

const deck = (offset2: string, title1 = '# One') =>
  `---\nscene: arm\ncamera:\n  lookAt: [0, 0.5, 0]\n  offset: [1, 1, 1]\n---\n${title1}\n` +
  `---\nscene: arm\ncamera:\n  offset: ${offset2}\n---\n# Two\n` +
  `---\nscene: arm\n---\n# Three\n`

describe('updateCameras', () => {
  it('copies changed cameras into the running slides, carried forward as the compiler does', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    const changed = updateCameras(running, compileForEditor(deck('[3, 3, 3]')))
    expect(changed).toEqual([1, 2]) // slide 3 inherits slide 2's camera
    expect(running[1].effective.camera).toEqual({ lookAt: [0, 0.5, 0], offset: [3, 3, 3] })
    expect(running[2].effective.camera).toEqual({ lookAt: [0, 0.5, 0], offset: [3, 3, 3] })
  })

  it('changes nothing when only the cameras are the same', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    expect(updateCameras(running, compileForEditor(deck('[2, 2, 2]')))).toEqual([])
  })

  it('refuses when anything besides cameras differs', () => {
    const running = compileForEditor(deck('[2, 2, 2]'))
    const before = JSON.stringify(running)
    expect(updateCameras(running, compileForEditor(deck('[3, 3, 3]', '# One, edited')))).toBeNull()
    expect(updateCameras(running, compileForEditor(deck('[2, 2, 2]') + '---\n---\n# Four\n'))).toBeNull()
    expect(JSON.stringify(running)).toBe(before)
  })
})
