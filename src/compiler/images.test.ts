import { describe, expect, it } from 'vitest'
import { compileLecture, IMAGE_TOKEN } from './compile-slides'

const one = (body: string, frontmatter = 'id: a') => `---\n${frontmatter}\n---\n${body}\n`

describe('compileLecture images (lysark-v2.md step 2)', () => {
  it('swaps a markdown image for a placeholder and reports it with its slide', () => {
    const { slides, images } = compileLecture(one('![arm](images/arm.png)'))
    expect(images).toEqual([{ src: 'images/arm.png', slide: 'a' }])
    expect(slides[0].fragments[0]).toContain(`src="${IMAGE_TOKEN}0"`)
    expect(slides[0].fragments[0]).not.toContain('images/arm.png')
  })

  it('handles raw HTML <img> too, with either quote style', () => {
    const { images, slides } = compileLecture(one(`<img src='a.png' alt="x"> and <img alt="y" src="b.jpg">`))
    expect(images.map((i) => i.src)).toEqual(['a.png', 'b.jpg'])
    expect(slides[0].fragments[0]).toContain(`src="${IMAGE_TOKEN}0"`)
    expect(slides[0].fragments[0]).toContain(`src="${IMAGE_TOKEN}1"`)
  })

  it('reports an image used twice once, naming the first slide', () => {
    const src = one('![x](p.png)', 'id: first') + one('![x](p.png)', 'id: second')
    const { images, slides } = compileLecture(src)
    expect(images).toEqual([{ src: 'p.png', slide: 'first' }])
    expect(slides[1].fragments[0]).toContain(`src="${IMAGE_TOKEN}0"`)
  })

  it('decodes HTML entities in the src', () => {
    const { images } = compileLecture(one('<img src="a&amp;b.png">'))
    expect(images[0].src).toBe('a&b.png')
  })

  it('leaves data: images alone', () => {
    const { images, slides } = compileLecture(one('<img src="data:image/png;base64,AAAA">'))
    expect(images).toEqual([])
    expect(slides[0].fragments[0]).toContain('data:image/png;base64,AAAA')
  })

  it('finds images in later fragments and in anchored labels', () => {
    const src = one(
      'intro\n<!-- pause -->\n![b](b.png)',
      'id: a\nscene: arm\nanchored:\n  - anchor: end_effector\n    content: "![tip](tip.png)"',
    )
    const { images, slides } = compileLecture(src)
    expect(images.map((i) => i.src).sort()).toEqual(['b.png', 'tip.png'])
    const label = slides[0].anchored[0]
    expect(label.kind === 'label' && label.html).toContain(IMAGE_TOKEN)
  })

  it('ignores image syntax inside code', () => {
    const { images } = compileLecture(one('`![x](not-an-image.png)`\n\n```\n<img src="also-not.png">\n```'))
    expect(images).toEqual([])
  })

  it('reports web addresses too, so the build can refuse them by slide', () => {
    const { images } = compileLecture(one('![x](https://example.com/x.png)'))
    expect(images).toEqual([{ src: 'https://example.com/x.png', slide: 'a' }])
  })

  it('refuses video and srcset with a message naming the slide', () => {
    expect(() => compileLecture(one('<video src="v.mp4"></video>'))).toThrow(/slide 1 \('a'\).*<video>/)
    expect(() => compileLecture(one('<img src="a.png" srcset="a2.png 2x">'))).toThrow(/srcset/)
    expect(() => compileLecture(one('<img alt="a > b" srcset="x 2x" src="y.png">'))).toThrow(/srcset/)
  })

  it('reads every valid way to write the src attribute', () => {
    const cases: Array<[string, string]> = [
      ['<img src=images/arm.png width=400>', 'images/arm.png'],
      ['<IMG SRC="upper.png">', 'upper.png'],
      ['<img alt="Kp > 1" src="step.png">', 'step.png'],
      ['<img src=https://example.com/a.png>', 'https://example.com/a.png'],
    ]
    for (const [html, src] of cases) {
      const { images, slides } = compileLecture(one(html))
      expect(images.map((i) => i.src), html).toEqual([src])
      expect(slides[0].fragments[0], html).toContain(`"${IMAGE_TOKEN}0"`)
    }
  })

  it('only rewrites the src attribute itself', () => {
    const { images, slides } = compileLecture(one(`<img data-src="ds.png" alt='see src="z.png"' src="real.png">`))
    expect(images.map((i) => i.src)).toEqual(['real.png'])
    expect(slides[0].fragments[0]).toContain('data-src="ds.png"')
    expect(slides[0].fragments[0]).toContain(`alt='see src="z.png"'`)
    expect(() => compileLecture(one('<img data-srcset="x" src="y.png">'))).not.toThrow()
  })

  it('ignores commented-out images and video', () => {
    const { images } = compileLecture(one('<!-- <video src="kuka.mp4"></video> -->\n\n<!-- <img src="todo.png"> -->\n\nText'))
    expect(images).toEqual([])
  })

  it('refuses SVG <image> and CSS url() images, but not url(#id) or inline data', () => {
    expect(() => compileLecture(one('<svg><image href="x.svg"/></svg>'))).toThrow(/slide 1 \('a'\).*SVG <image>/)
    expect(() => compileLecture(one('<div style="background: url(x.png)"></div>'))).toThrow(/url\(\)/)
    expect(() => compileLecture(one('<svg><path marker-end="url(#arrow)"/></svg>'))).not.toThrow()
    expect(() => compileLecture(one('<div style="background: url(data:image/png;base64,AA)"></div>'))).not.toThrow()
    expect(() => compileLecture(one('Write `url(x.png)` in CSS.'))).not.toThrow()
  })
})
