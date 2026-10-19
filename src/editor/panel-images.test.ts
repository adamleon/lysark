import { describe, expect, it } from 'vitest'
import { imagePaths, loadImages } from './panel-images'

describe('imagePaths', () => {
  it('gives the paths to try, decoded spelling included', () => {
    expect(imagePaths('images/arm.png')).toEqual({ paths: ['images/arm.png'] })
    expect(imagePaths('./images/two%20links.svg?v=2')).toEqual({ paths: ['images/two%20links.svg', 'images/two links.svg'] })
    expect(imagePaths('../../assets/kuka.JPG')).toEqual({ paths: ['../../assets/kuka.JPG'] })
  })

  it('names the problems the build would report', () => {
    for (const [src, problem] of [
      ['https://example.com/x.png', /web address/],
      ['//example.com/x.png', /web address/],
      ['C:/Users/x.png', /absolute path/],
      ['images\\x.png', /backslash/],
      ['/images/x.png', /starts with/],
      ['images/x.bmp', /not a supported image type/],
    ] as const) {
      const found = imagePaths(src)
      expect('problem' in found && found.problem, src).toMatch(problem)
    }
  })
})

describe('loadImages', () => {
  it('reads each file once and makes data URIs; reports the rest', async () => {
    const asked: string[][] = []
    const { uris, problems } = await loadImages(
      [
        { src: 'a.png', slide: 's1' },
        { src: 'a.png', slide: 's2' },
        { src: 'b%20c.svg', slide: 's2' },
        { src: 'gone.gif', slide: 's3' },
        { src: 'https://x/y.png', slide: 's3' },
      ],
      async (paths) => {
        asked.push(paths)
        return {
          'a.png': { base64: 'AAAA' },
          'b%20c.svg': { error: 'not found' },
          'b c.svg': { base64: 'PHN2Zz4=' },
          'gone.gif': { error: 'not found' },
        }
      },
    )
    expect(asked).toEqual([['a.png', 'b%20c.svg', 'b c.svg', 'gone.gif']])
    expect(uris).toEqual({ 'a.png': 'data:image/png;base64,AAAA', 'b%20c.svg': 'data:image/svg+xml;base64,PHN2Zz4=' })
    expect(problems).toEqual([expect.stringMatching(/web address/), "'gone.gif': not found"])
  })

  it('asks for nothing when there are no images to read', async () => {
    let asked = false
    const result = await loadImages([], async () => {
      asked = true
      return {}
    })
    expect(asked).toBe(false)
    expect(result).toEqual({ uris: {}, problems: [] })
  })
})
