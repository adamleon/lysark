import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { parse as parseYaml } from 'yaml'
import type {
  CameraTargetSpec,
  CompiledSlide,
  SlideTargets,
  WidgetSpec,
} from '../engine/slide-types'

/**
 * Build-time slide compiler (spec §8): markdown + YAML frontmatter →
 * CompiledSlide[]. Runs in the Vite plugin and in tests — never in the
 * browser, so markdown-it/yaml/katex stay out of the runtime bundle.
 *
 * Authoring notes enforced here:
 * - Slides are separated by frontmatter blocks (`---` fences). Use `***` for
 *   a horizontal rule in bodies, never `---`.
 * - `<!-- pause -->` on its own line splits the body into fragments (§4.3).
 * - `$…$` / `$$…$$` are KaTeX, pre-rendered here; don't use bare `$` in prose
 *   (escape as `\$`), and keep math out of code blocks.
 */

const md = new MarkdownIt({ html: true })

const PAUSE = /^<!--\s*pause\s*-->\s*$/m

interface RawSlide {
  frontmatter: Record<string, unknown>
  body: string
}

function splitSlides(source: string): RawSlide[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const slides: RawSlide[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    if (lines[i] !== '---') {
      throw new Error(`slides: expected '---' frontmatter fence at line ${i + 1}, got: ${lines[i]}`)
    }
    const yamlStart = ++i
    while (i < lines.length && lines[i] !== '---') i++
    if (i >= lines.length) throw new Error('slides: unterminated frontmatter block')
    const yamlText = lines.slice(yamlStart, i).join('\n')
    i++ // skip closing fence
    const bodyStart = i
    while (i < lines.length && lines[i] !== '---') i++
    const body = lines.slice(bodyStart, i).join('\n')
    const frontmatter = (parseYaml(yamlText) ?? {}) as Record<string, unknown>
    slides.push({ frontmatter, body })
  }
  return slides
}

/** pre-render math before markdown so underscores etc. survive */
function renderWithMath(chunk: string): string {
  const rendered: string[] = []
  const stash = (tex: string, displayMode: boolean): string => {
    rendered.push(katex.renderToString(tex, { displayMode, throwOnError: false }))
    return `%%MATH_${rendered.length - 1}%%`
  }
  const withPlaceholders = chunk
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => stash(tex, true))
    .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex: string) => stash(tex, false))
    .replace(/\\\$/g, '$')
  return md
    .render(withPlaceholders)
    .replace(/%%MATH_(\d+)%%/g, (_, n: string) => rendered[Number(n)])
}

function mergeCamera(
  inherited: CameraTargetSpec | undefined,
  declared: CameraTargetSpec | undefined,
): CameraTargetSpec | undefined {
  if (!declared) return inherited
  const merged: CameraTargetSpec = { ...inherited, ...declared }
  // offset and distance are alternative framings — a newly declared one wins
  if (declared.offset && !declared.distance) delete merged.distance
  if (declared.distance != null && !declared.offset) delete merged.offset
  return merged
}

export function compileSlides(source: string): CompiledSlide[] {
  const raw = splitSlides(source)
  const out: CompiledSlide[] = []
  let joints: Record<string, number> = {}
  let camera: CameraTargetSpec | undefined

  raw.forEach(({ frontmatter, body }, index) => {
    const declaredJoints = (frontmatter.joints ?? {}) as Record<string, number>
    for (const [name, value] of Object.entries(declaredJoints)) {
      if (typeof value !== 'number') {
        throw new Error(`slides: joint '${name}' target must be a number, got ${typeof value}`)
      }
      joints[name] = value
    }
    camera = mergeCamera(camera, frontmatter.camera as CameraTargetSpec | undefined)

    const effective: SlideTargets = { joints: { ...joints } }
    if (camera && Object.keys(camera).length > 0) effective.camera = { ...camera }

    const layout = frontmatter.layout === 'center' ? 'center' : 'panel'
    const widgets = (frontmatter.widgets ?? []) as WidgetSpec[]
    for (const w of widgets) {
      if (w.type !== 'slider') throw new Error(`slides: unknown widget type '${(w as { type: string }).type}' (M3 supports: slider)`)
      if (!w.bind) throw new Error(`slides: widget on slide ${index + 1} is missing 'bind'`)
    }

    const fragments = body
      .split(PAUSE)
      .map((chunk) => renderWithMath(chunk.trim()))
      .filter((html) => html.length > 0)

    out.push({
      id: typeof frontmatter.id === 'string' ? frontmatter.id : `slide-${index + 1}`,
      scene: typeof frontmatter.scene === 'string' ? frontmatter.scene : undefined,
      layout,
      effective,
      widgets,
      fragments: fragments.length > 0 ? fragments : [''],
    })
  })

  const ids = new Set<string>()
  for (const slide of out) {
    if (ids.has(slide.id)) throw new Error(`slides: duplicate slide id '${slide.id}'`)
    ids.add(slide.id)
  }
  return out
}
