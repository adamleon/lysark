import type { Plugin } from 'vite'
import { compileSlides } from './src/compiler/compile-slides'

/**
 * Compiles src/content/*.md decks to slide objects at build time (spec §8).
 * The browser imports plain data; markdown-it/yaml/katex never ship.
 */
export function slidesPlugin(): Plugin {
  return {
    name: 'lysark-slides',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.md')) return null
      const slides = compileSlides(code)
      return { code: `export default ${JSON.stringify(slides)}`, map: null }
    },
  }
}
