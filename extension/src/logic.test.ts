import { describe, expect, it } from 'vitest'
import {
  bytesToBase64,
  editorUrl,
  fileProblem,
  includePatterns,
  isCameraView,
  isCoursePackage,
  isCreatablePath,
  isWritablePath,
  notificationText,
  resolveInside,
} from './logic'

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
