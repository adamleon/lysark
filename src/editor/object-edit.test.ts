import { describe, expect, it } from 'vitest'
import { readSceneFiles } from '../compiler/scene-files'
import type { SceneObject } from '../engine/object-types'
import { objectEdit, objectsFile, placeText, placementChanges, setObjectPlace } from './object-edit'

const CELL = `base: arm

objects:                     # things in the scene
  table:                     # a work table
    box: [0.4, 0.3, 0.4]     # width, height, depth
    at: [0.62, 0, -0.69]     # on the floor
    rotate: 48               # turned about the vertical
    material: wood
  part:
    cylinder: [0.07, 0.1]
    at: [0, 0.3, 0]
    parent: table
  grip:                      # an invisible point
    parent: part
  base frame:
    frame: 0.3
    parent: base
`

/** the object as the compiler reads the edited file */
const read = (text: string, name: string) => readSceneFiles({ 'scenes/arm.yaml': text }).get('arm')!.objects.find((o) => o.name === name)!

describe('setObjectPlace', () => {
  it('replaces only the numbers that changed, each where it stands', () => {
    const out = setObjectPlace(CELL, 'table', { at: [0.7, 0, -0.6] })
    expect(out).toBe(CELL.replace('at: [0.62, 0, -0.69]     # on the floor', 'at: [0.7, 0, -0.6]     # on the floor'))
    expect(read(out, 'table').at).toEqual([0.7, 0, -0.6])
    // a number written another way but the same stays as written
    const written = CELL.replace('[0.62, 0, -0.69]', '[0.620, 0.0, -0.69]')
    expect(setObjectPlace(written, 'table', { at: [0.62, 0, -0.5] })).toBe(written.replace('-0.69]', '-0.5]'))
  })

  it('keeps rotate a number while the object turns about y only, and makes it a list when not', () => {
    expect(setObjectPlace(CELL, 'table', { rotate: [0, 50, 0] })).toBe(CELL.replace('rotate: 48 ', 'rotate: 50 '))
    expect(setObjectPlace(CELL, 'table', { rotate: [90, 48, 0] })).toBe(CELL.replace('rotate: 48 ', 'rotate: [90, 48, 0] '))
    const listed = CELL.replace('rotate: 48 ', 'rotate: [0, 48, 0] ')
    expect(setObjectPlace(listed, 'table', { rotate: [0, -170, 0] })).toBe(listed.replace('[0, 48, 0]', '[0, -170, 0]'))
    expect(read(setObjectPlace(CELL, 'table', { rotate: [90, 48, 0] }), 'table').rotate).toEqual([90, 48, 0])
  })

  it("adds an at or rotate the object didn't have, after its other keys", () => {
    const out = setObjectPlace(CELL, 'grip', { at: [0, 0.12, 0], rotate: [0, 30, 0] })
    expect(out).toBe(CELL.replace('    parent: part\n', '    parent: part\n    at: [0, 0.12, 0]\n    rotate: 30\n'))
    expect(read(out, 'grip')).toMatchObject({ at: [0, 0.12, 0], rotate: [0, 30, 0] })
    // the value without one: nothing added
    expect(setObjectPlace(CELL, 'grip', { at: [0, 0, 0], rotate: [0, 0, 0] })).toBe(CELL)
    // the last object of the file
    const last = setObjectPlace(CELL, 'base frame', { rotate: [0, 0, 90] })
    expect(last).toBe(`${CELL}    rotate: [0, 0, 90]\n`)
    // at the end of a file without a final newline
    expect(setObjectPlace(CELL.trimEnd(), 'base frame', { at: [0.1, 0, 0] })).toBe(`${CELL.trimEnd()}\n    at: [0.1, 0, 0]`)
  })

  it('adds after a block list and a comment on the last line, before the next object', () => {
    const block = `base: arm
objects:
  table:
    box:
      - 0.4
      - 0.3
      - 0.4   # depth
  # the next one
  part:
    sphere: 0.1
`
    expect(setObjectPlace(block, 'table', { at: [1, 0, 0] })).toBe(block.replace('      - 0.4   # depth\n', '      - 0.4   # depth\n    at: [1, 0, 0]\n'))
  })

  it('writes into a list written one item per line, and into a flow mapping', () => {
    const block = 'base: arm\nobjects:\n  table:\n    box: [0.4, 0.3, 0.4]\n    at:\n      - 0.62\n      - 0     # on the floor\n      - -0.69\n'
    const out = setObjectPlace(block, 'table', { at: [0.62, 0, -0.7] })
    expect(out).toBe(block.replace('- -0.69', '- -0.7'))
    const flow = 'base: arm\nobjects:\n  part: { cylinder: [0.07, 0.1], material: blue }   # a part\n'
    expect(setObjectPlace(flow, 'part', { at: [0.2, 0, 0.1], rotate: [0, 45, 0] })).toBe(
      'base: arm\nobjects:\n  part: { cylinder: [0.07, 0.1], material: blue, at: [0.2, 0, 0.1], rotate: 45 }   # a part\n',
    )
    const flowAt = 'base: arm\nobjects:\n  part: { cylinder: [0.07, 0.1], at: [0, 0, 0] }\n'
    expect(setObjectPlace(flowAt, 'part', { at: [0, 0, 0.25] })).toBe(flowAt.replace('[0, 0, 0]', '[0, 0, 0.25]'))
  })

  it('keeps line endings and a byte-order mark', () => {
    const crlf = '﻿' + CELL.replace(/\n/g, '\r\n')
    const out = setObjectPlace(crlf, 'grip', { at: [0, 0.12, 0] })
    expect(out).toBe('﻿' + CELL.replace('    parent: part\n', '    parent: part\n    at: [0, 0.12, 0]\n').replace(/\n/g, '\r\n'))
  })

  it("refuses what it can't write over without changing more than the place", () => {
    expect(() => setObjectPlace(CELL.replace('at: [0.62, 0, -0.69]', 'at: &p [0.62, 0, -0.69]'), 'table', { at: [0, 0, 0] })).toThrow(
      /object 'table' at isn't written as three plain numbers/,
    )
    expect(() => setObjectPlace(CELL.replace('rotate: 48', 'rotate: !!float 48'), 'table', { rotate: [0, 50, 0] })).toThrow(/can't be turned from the panel/)
    expect(() => setObjectPlace(CELL, 'chair', { at: [0, 0, 0] })).toThrow(/no object 'chair'/)
    expect(() => setObjectPlace('objects: [', 'table', { at: [0, 0, 0] })).toThrow(/YAML error/)
  })

  it('indents an added key as the keys of the object are, whatever comes before its first key', () => {
    for (const first of ['? sphere\n    : 0.1', '?\tsphere\n    : 0.1', '?\n      sphere\n    : 0.1', '!!str sphere: 0.1', '!!str\tsphere: 0.1', '&k sphere: 0.1']) {
      const src = `base: arm\nobjects:\n  ball:\n    ${first}\n    parent: base\n`
      const out = setObjectPlace(src, 'ball', { at: [1, 0, 0] })
      expect(out).toBe(`${src}    at: [1, 0, 0]\n`)
      expect(read(out, 'ball').at).toEqual([1, 0, 0])
    }
    // the object's own name written as an explicit key: its keys stand after the `: `
    const explicit = 'base: arm\nobjects:\n  ? ball\n  : sphere: 0.1\n    parent: base\n'
    const out = setObjectPlace(explicit, 'ball', { at: [1, 0, 0] })
    expect(out).toBe(`${explicit}    at: [1, 0, 0]\n`)
    expect(read(out, 'ball').at).toEqual([1, 0, 0])
  })
})

describe('objectEdit', () => {
  const TABLE = { at: [0.62, 0, -0.69] as [number, number, number], rotate: [0, 48, 0] as [number, number, number] }

  it('gives the edit, null for none, or the problem', () => {
    expect(objectEdit(CELL, 'table', TABLE, TABLE)).toBeNull()
    expect(objectEdit(CELL, 'table', { ...TABLE, rotate: [0, 50, 0] }, TABLE)).toEqual({ start: CELL.indexOf('48'), end: CELL.indexOf('48') + 2, text: '50' })
    expect(objectEdit(CELL, 'chair', { ...TABLE, at: [1, 0, 0] }, TABLE)).toEqual({ problem: "the scene file has no object 'chair' to move" })
  })

  it("writes only what the move changed, and leaves typing the panel hasn't had in the rest", () => {
    // typed (unsaved): another rotate; the panel moved the table along the floor
    const typed = CELL.replace('rotate: 48 ', 'rotate: 90 ')
    const change = objectEdit(typed, 'table', { ...TABLE, at: [0.7, 0, -0.6] }, TABLE)
    expect(change).not.toBeNull()
    const out = typed.slice(0, (change as { start: number }).start) + (change as { text: string }).text + typed.slice((change as { end: number }).end)
    expect(read(out, 'table')).toMatchObject({ at: [0.7, 0, -0.6], rotate: [0, 90, 0] })
    // but not over typing in what it writes: it says to save first
    const moved = CELL.replace('[0.62, 0, -0.69]', '[0.62, 0.1, -0.69]')
    expect(objectEdit(moved, 'table', { ...TABLE, at: [0.7, 0, -0.6] }, TABLE)).toEqual({
      problem: "the scene file has 'table' elsewhere than the panel shows (at: [0.62, 0.1, -0.69]; typing the panel has not had yet?): save the file (Ctrl+S), then try again",
    })
    expect(objectEdit(typed, 'table', { ...TABLE, rotate: [0, 50, 0] }, TABLE)).toMatchObject({ problem: expect.stringMatching(/turned otherwise than the panel shows \(rotate: \[0, 90, 0\]/) })
  })

  it('turns an object whose at is written with an anchor, which it leaves alone', () => {
    const anchored = CELL.replace('at: [0.62, 0, -0.69]', 'at: &p [0.62, 0, -0.69]')
    const change = objectEdit(anchored, 'table', { ...TABLE, rotate: [0, 50, 0] }, TABLE)
    expect(change).toEqual({ start: anchored.indexOf('48'), end: anchored.indexOf('48') + 2, text: '50' })
    expect(objectEdit(anchored, 'table', { ...TABLE, at: [0, 0, 0] }, TABLE)).toMatchObject({ problem: expect.stringMatching(/isn't written as three plain numbers/) })
  })
})

describe('objects in the files', () => {
  it('finds the scene file with the objects of a scene', () => {
    // in the file's order (the compiler's has the parents first)
    expect(objectsFile({ 'slides.md': '', 'scenes/arm.yaml': CELL }, 'arm')).toEqual({ path: 'scenes/arm.yaml', names: ['table', 'part', 'grip', 'base frame'] })
    expect(objectsFile({ 'scenes/arm.yaml': CELL }, 'agilus')).toBeNull()
    expect(objectsFile({ 'scenes/arm.yaml': 'base: arm\n' }, 'arm')).toBeNull()
    expect(objectsFile({ 'scenes/arm.yaml': 'base: [' }, 'arm')).toBeNull()
  })

  it('writes a place for people', () => {
    expect(placeText({ at: [0.62, 0, -0.69], rotate: [0, 48, 0] })).toBe('at [0.62, 0, -0.69] · rotate 48')
    expect(placeText({ at: [0, 0, 0], rotate: [90, 0, 0] })).toBe('at [0, 0, 0] · rotate [90, 0, 0]')
  })

  it('tells a new place from a change that needs the scene built afresh', () => {
    const objects = (at: [number, number, number], extra: Partial<SceneObject> = {}): Record<string, SceneObject[]> => ({
      arm: [{ name: 'table', shape: 'box', size: [0.4, 0.3, 0.4], at, rotate: [0, 48, 0], material: 'wood', ...extra }],
    })
    expect(placementChanges(objects([0, 0, 0]), objects([0, 0, 0]))).toEqual([])
    expect(placementChanges(objects([0, 0, 0]), objects([1, 0, 0]))).toEqual([{ scene: 'arm', index: 0, object: objects([1, 0, 0]).arm[0] }])
    expect(placementChanges(objects([0, 0, 0]), objects([0, 0, 0], { rotate: [0, 50, 0] }))).toHaveLength(1)
    expect(placementChanges(objects([0, 0, 0]), objects([1, 0, 0], { material: 'red' }))).toBeNull()
    expect(placementChanges(objects([0, 0, 0]), objects([0, 0, 0], { size: [0.4, 0.3, 0.5] }))).toBeNull()
    expect(placementChanges(objects([0, 0, 0]), objects([0, 0, 0], { parent: 'base' }))).toBeNull()
    expect(placementChanges(objects([0, 0, 0]), {})).toBeNull()
    expect(placementChanges({}, objects([0, 0, 0]))).toBeNull()
    expect(placementChanges({}, {})).toEqual([])
  })

  it("loads a model object afresh for any change but its place, as the compiler reads the file", () => {
    const scene = (bracket: string) =>
      readSceneFiles({ 'scenes/arm.yaml': `base: arm\n\nobjects:\n  table:\n    box: [0.4, 0.3, 0.4]\n  bracket:\n${bracket}` }).get('arm')!.objects
    const before = { arm: scene('    model: models/bracket.stl\n    unit: mm\n    up: z\n    at: [0, 0.3, 0]\n    parent: table\n') }
    const after = (text: string) => placementChanges(before, { arm: scene(text) })
    // moved, typed or dragged: in place
    const moved = after('    model: models/bracket.stl\n    unit: mm\n    up: z\n    at: [0.1, 0.3, 0]\n    rotate: 30\n    parent: table\n')
    expect(moved).toEqual([{ scene: 'arm', index: 1, object: expect.objectContaining({ name: 'bracket', at: [0.1, 0.3, 0], rotate: [0, 30, 0] }) }])
    // the same keys in another order are the same object
    expect(after('    parent: table\n    at: [0, 0.3, 0]\n    up: z\n    unit: mm\n    model: models/bracket.stl\n')).toEqual([])
    // another file, unit, up, colour or parent: the scene is built afresh
    for (const changed of [
      '    model: models/bracket.glb\n    unit: mm\n    up: z\n    at: [0, 0.3, 0]\n    parent: table\n',
      '    model: models/bracket.stl\n    unit: cm\n    up: z\n    at: [0, 0.3, 0]\n    parent: table\n',
      '    model: models/bracket.stl\n    unit: mm\n    at: [0, 0.3, 0]\n    parent: table\n',
      '    model: models/bracket.stl\n    unit: mm\n    up: z\n    at: [0, 0.3, 0]\n    parent: table\n    material: metal\n',
      '    model: models/bracket.stl\n    unit: mm\n    up: z\n    at: [0, 0.3, 0]\n',
    ]) {
      expect(after(changed), changed).toBeNull()
    }
  })

  it('counts every key but at and rotate, a key objects get later too', () => {
    const table: SceneObject = { name: 'table', shape: 'box', size: [0.4, 0.3, 0.4], at: [0, 0, 0], rotate: [0, 0, 0], material: 'wood' }
    const extra = { ...table, later: 1 } as SceneObject
    expect(placementChanges({ arm: [table] }, { arm: [extra] })).toBeNull()
    expect(placementChanges({ arm: [extra] }, { arm: [{ ...extra, at: [1, 0, 0] }] })).toHaveLength(1)
  })
})
