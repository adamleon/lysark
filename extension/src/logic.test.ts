import { describe, expect, it } from 'vitest'
import {
  bytesToBase64,
  editorShowing,
  editorUrl,
  fileProblem,
  includePatterns,
  isCameraView,
  isCoursePackage,
  isCreatablePath,
  isEnginePackage,
  isWritablePath,
  notificationText,
  resolveInside,
  startingSlide,
} from './logic'

describe('startingSlide', () => {
  // two blank lines, then three slides; slide 2 has a body with a code block holding a ---
  const lines = [
    '', // 0
    '', // 1
    '---', // 2  slide 0 opens
    'id: first', // 3
    '---', // 4
    '# One', // 5
    '', // 6
    '---', // 7  slide 1 opens
    'id: second', // 8
    'scene: arm', // 9
    '---', // 10
    '## Two', // 11
    '```yaml', // 12
    '---', // 13  inside a code block: not a separator
    '```', // 14
    '---  ', // 15  slide 2 opens (trailing spaces allowed)
    '---', // 16  an empty settings block
    '## Three', // 17
    '', // 18
  ]
  const text = lines.join('\n')

  it('is the slide the cursor is in: its settings, its separator lines or its body', () => {
    expect(startingSlide(text, 5)).toBe(0)
    expect([7, 8, 9, 10, 11].map((line) => startingSlide(text, line))).toEqual([1, 1, 1, 1, 1])
    // a --- in a code block belongs to the slide's body
    expect([12, 13, 14].map((line) => startingSlide(text, line))).toEqual([1, 1, 1])
    expect([15, 16, 17, 18].map((line) => startingSlide(text, line))).toEqual([2, 2, 2, 2])
  })

  it("is the first slide in the first slide's settings, and above the first slide", () => {
    expect([2, 3, 4].map((line) => startingSlide(text, line))).toEqual([0, 0, 0])
    // the blank lines before the first --- are in no slide
    expect([0, 1].map((line) => startingSlide(text, line))).toEqual([0, 0])
  })

  it('is the last slide past the end of the text', () => {
    expect(startingSlide(text, 40)).toBe(2)
  })

  it("is the first slide with no cursor, or a text that doesn't split into slides", () => {
    expect(startingSlide(text, null)).toBe(0)
    // a new slide half typed: its --- pairs with the next slide's, and the text ends in a settings block
    expect(startingSlide(`${text}\n---\nid: fourth\n`, 18)).toBe(0)
    // text before the first ---
    expect(startingSlide(`# Notes\n${text}`, 12)).toBe(0)
    expect(startingSlide('', 0)).toBe(0)
  })

  it('counts lines the same with \\r\\n line endings and a byte order mark', () => {
    const crlf = `﻿${lines.join('\r\n')}`
    expect([0, 3, 7, 13, 15, 18].map((line) => startingSlide(crlf, line))).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('editorShowing', () => {
  const doc = { name: 'slides.md' }
  const other = { name: 'README.md' }
  const active = { document: doc, id: 'active' }
  const beside = { document: doc, id: 'beside' }
  const readme = { document: other, id: 'readme' }

  it('prefers the active editor, else the first visible one that shows the document', () => {
    expect(editorShowing(doc, active, [readme, beside, active])).toBe(active)
    expect(editorShowing(doc, readme, [readme, beside, active])).toBe(beside)
    expect(editorShowing(doc, undefined, [beside])).toBe(beside)
  })

  it('is none when no editor shows it (opened from the Explorer)', () => {
    expect(editorShowing(doc, readme, [readme])).toBeUndefined()
    expect(editorShowing(doc, undefined, [])).toBeUndefined()
  })
})

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

describe('isEnginePackage', () => {
  it('is true only for the engine’s own package.json', () => {
    expect(isEnginePackage({ name: 'lysark', version: '2.13.1' })).toBe(true)
    expect(isEnginePackage({ name: 'test-course', dependencies: { lysark: 'github:adamleon/lysark' } })).toBe(false)
    expect(isEnginePackage({})).toBe(false)
    expect(isEnginePackage(null)).toBe(false)
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

describe('resolveInside', () => {
  const lecture = '/course/lectures/intro'
  const roots = [lecture, '/course/assets']

  it('resolves paths inside the lecture folder and the course assets', () => {
    expect(resolveInside(lecture, 'slides.md', roots)).toBe('/course/lectures/intro/slides.md')
    expect(resolveInside(lecture, './img/a.png', roots)).toBe('/course/lectures/intro/img/a.png')
    expect(resolveInside(lecture, '../../assets/kuka.png', roots)).toBe('/course/assets/kuka.png')
    expect(resolveInside(lecture + '/', 'scenes/agilus.yaml', roots)).toBe('/course/lectures/intro/scenes/agilus.yaml')
    expect(resolveInside(lecture, '.', roots)).toBe(lecture)
    // an empty segment counts as none, as in the course build
    expect(resolveInside(lecture, 'images//a.png', roots)).toBe('/course/lectures/intro/images/a.png')
  })

  it('refuses anything that leaves them, or is not a plain relative path', () => {
    for (const rel of ['../other/slides.md', '../../package.json', '../intro-x/a.png', '/etc/passwd', 'c:/x', 'a:b.png', '', 'img/../../..', '.git/config', 'images/.hidden.png', '../../.env', 'ENV~1', 'GIT~1/config', '../../assets/CACHE~1/x.png']) {
      expect(resolveInside(lecture, rel, roots), rel).toBeNull()
    }
    expect(resolveInside(lecture, 'a' + String.fromCharCode(92) + 'b', roots)).toBeNull()
    expect(resolveInside(lecture, '../../assets/x.png', [lecture])).toBeNull()
  })
})

describe('isWritablePath and isCreatablePath', () => {
  it('allow slides.md and scene files only', () => {
    expect(isWritablePath('slides.md')).toBe(true)
    expect(isWritablePath('scenes/agilus.yaml')).toBe(true)
    expect(isWritablePath('scenes/agilus.yml')).toBe(true)
    for (const rel of ['./slides.md', 'scenes/../slides.md', 'scenes/a/b.yaml', 'scenes/.x.yaml', 'img/a.png', 'package.json', 'scenes/Agilus.yaml']) {
      expect(isWritablePath(rel), rel).toBe(false)
    }
    expect(isCreatablePath('scenes/agilus.yaml')).toBe(true)
    expect(isCreatablePath('scenes/agilus.yml')).toBe(false)
    expect(isCreatablePath('slides.md')).toBe(false)
  })
})

describe('includePatterns', () => {
  it('lists one folder and matches its files by extension', () => {
    const inc = includePatterns(['scenes/*.yaml', 'scenes/*.yml', '**/*', 'a/b/*.x', 'media/*.mp4', 42])
    expect(inc.dirs).toEqual(['scenes'])
    expect(inc.matches('scenes/agilus.yaml')).toBe(true)
    expect(inc.matches('scenes/agilus.yml')).toBe(true)
    for (const rel of ['scenes/.yaml', 'scenes/a/b.yaml', 'slides.md', 'scenes/a.yamlx', 'other/a.yaml']) {
      expect(inc.matches(rel), rel).toBe(false)
    }
    expect(includePatterns(undefined).dirs).toEqual([])
  })
})

describe('fileProblem', () => {
  it('gives a short reason by code, never the message with its path', () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, scandir 'c:\\Users\\someone\\x'"), { code: 'FileNotFound' })
    expect(fileProblem(err)).toBe('not found')
    expect(fileProblem(Object.assign(new Error('/home/someone/x'), { code: 'NoPermissions' }))).toBe('no permission')
    expect(fileProblem(new Error('/home/someone/x'))).toBe('could not be read')
    expect(fileProblem(null)).toBe('could not be read')
  })
})

describe('bytesToBase64', () => {
  it('matches the standard encoding, past one chunk', () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})
