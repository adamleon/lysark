import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveImage, slidesPlugin } from './vite-plugin-slides'

let course: string
let lecture: string
let slidesPath: string

beforeAll(() => {
  course = mkdtempSync(join(tmpdir(), 'lysark-images-'))
  lecture = join(course, 'lectures', 'l1')
  mkdirSync(join(lecture, 'images'), { recursive: true })
  mkdirSync(join(course, 'lectures', 'other', 'images'), { recursive: true })
  mkdirSync(join(course, 'assets'), { recursive: true })
  slidesPath = join(lecture, 'slides.md')
  writeFileSync(slidesPath, '')
  writeFileSync(join(lecture, 'images', 'arm.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(lecture, 'images', 'rød robot.jpg'), Buffer.from([0xff, 0xd8]))
  writeFileSync(join(lecture, 'images', 'IMG_1234.JPG'), Buffer.from([0xff, 0xd8]))
  writeFileSync(join(lecture, 'notes.txt'), 'not an image')
  writeFileSync(join(course, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(course, 'lectures', 'other', 'images', 'x.png'), Buffer.from([0x89]))
})

afterAll(() => rmSync(course, { recursive: true, force: true }))

const ref = (src: string) => ({ src, slide: 's3' })
const resolveIn = (src: string) => resolveImage(ref(src), slidesPath, course)

describe('resolveImage (build side of lysark-v2.md step 2)', () => {
  it('finds an image relative to slides.md', () => {
    expect(resolveIn('images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
    expect(resolveIn('./images/arm.png')).toBe(join(lecture, 'images', 'arm.png'))
  })

  it('reaches the course assets folder with ../', () => {
    expect(resolveIn('../../assets/logo.svg')).toBe(join(course, 'assets', 'logo.svg'))
  })

  it('accepts a percent-encoded name, as markdown writes spaces and ø', () => {
    expect(resolveIn('images/r%C3%B8d%20robot.jpg')).toBe(join(lecture, 'images', 'rød robot.jpg'))
  })

  it('refuses a web address, naming the lecture and slide', () => {
    expect(() => resolveIn('https://example.com/a.png')).toThrow(/l1\/slides\.md, slide 's3'.*web address/)
    expect(() => resolveIn('//cdn.example.com/a.png')).toThrow(/web address/)
  })

  it('refuses a path starting with /, a backslash, or a drive letter', () => {
    expect(() => resolveIn('/images/arm.png')).toThrow(/relative to slides\.md/)
    expect(() => resolveIn('images\\arm.png')).toThrow(/backslash/)
    expect(() => resolveIn('images%5Carm.png')).toThrow(/backslash/)
    expect(() => resolveIn('C:/pics/x.png')).toThrow(/absolute path/)
  })

  it('refuses an image outside the lecture folder and assets/', () => {
    expect(() => resolveIn('../other/images/x.png')).toThrow(/outside the lecture folder/)
    expect(() => resolveIn('../../../elsewhere/p.png')).toThrow(/outside the lecture folder/)
  })

  it('refuses wrong capital letters, naming the file on disk', () => {
    expect(() => resolveIn('images/img_1234.jpg')).toThrow(/wrong capital letters.*IMG_1234\.JPG/)
    expect(() => resolveIn('Images/arm.png')).toThrow(/wrong capital letters.*'images'/)
  })

  it('refuses a missing file, naming the slide, and reports where it looked', () => {
    let looked: string[] = []
    expect(() => resolveImage(ref('images/missing.png'), slidesPath, course, (p) => (looked = p))).toThrow(
      /slide 's3'.*not found/,
    )
    expect(looked).toEqual([join(lecture, 'images', 'missing.png')])
  })

  it('refuses a file that is not an image', () => {
    expect(() => resolveIn('notes.txt')).toThrow(/not a supported image type/)
  })
})

describe('slidesPlugin transform', () => {
  it('stores each image file once, however many slides and spellings use it', () => {
    const md = [
      '---\nid: a\n---\n![x](images/arm.png)',
      '---\nid: b\n---\n![x](images/arm.png)',
      '---\nid: c\n---\n<img src="./images/arm.png" width="100">',
    ].join('\n')
    const plugin = slidesPlugin({ courseRoot: course })
    const transform = plugin.transform as (this: unknown, code: string, id: string) => { code: string }
    const { code } = transform.call({ addWatchFile() {} }, md, slidesPath)
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    expect(code.split(base64).length - 1).toBe(1)
    expect(code).not.toContain('lysark-image:')
    // the module is valid JavaScript whose slides hold the full data URI three times
    const slides = new Function(code.replace('export default', 'return'))() as Array<{ fragments: string[] }>
    expect(slides.map((s) => s.fragments[0].includes(`data:image/png;base64,${base64}`))).toEqual([true, true, true])
    expect(existsSync(slidesPath)).toBe(true)
  })
})
