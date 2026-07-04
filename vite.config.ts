import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { slidesPlugin } from './vite-plugin-slides'

const OFFLINE_DIR = 'dist-offline'
const OFFLINE_HTML = 'lysark-offline.html'

/**
 * Size pass (spec §11): KaTeX ships every glyph as woff2 + woff + ttf, and the
 * offline build base64-inlines whatever the CSS references — so all three formats
 * would ride along, tripling the font payload. Every browser that can open the
 * deck supports woff2, so drop the woff/ttf fallbacks from each @font-face src
 * before Vite resolves the url()s (applies to all targets; harmless in dev).
 */
function katexWoff2Only(): Plugin {
  return {
    name: 'lysark-katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('katex') || !id.endsWith('.css')) return null
      // Match the src value up to its terminator — `;` OR the `}` that closes an
      // @font-face (minified katex.min.css omits the trailing `;`). Excluding
      // `{}` from the value keeps the match inside one block, and re-emitting the
      // captured terminator preserves the block boundary. A bare `[^;]+;` here
      // swallows the `}` and merges every @font-face into one broken rule.
      const out = code.replace(/src:([^;{}]+)([;}])/g, (whole, list: string, term: string) => {
        const kept = list
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /woff2/i.test(s))
        return kept.length > 0 ? `src:${kept.join(',')}${term}` : whole
      })
      return out === code ? null : { code: out, map: null }
    },
  }
}

/**
 * After the single-file bundle is written, rename index.html → lysark-offline.html
 * so the student-offline deliverable has its documented name (spec §9b). It is
 * the only file in the output dir, so a plain rename is safe.
 */
function renameOfflineHtml(): Plugin {
  return {
    name: 'lysark-rename-offline-html',
    enforce: 'post',
    async closeBundle() {
      await rename(join(OFFLINE_DIR, 'index.html'), join(OFFLINE_DIR, OFFLINE_HTML)).catch(
        () => undefined,
      )
    },
  }
}

// Three delivery targets from one codebase (spec §9), selected by --mode:
//   vite build                    → classroom static dist/ (base './' survives file:// too)
//   vite build --mode singlefile  → one self-contained dist-offline/lysark-offline.html
// base './' so relative asset paths survive all targets. The offline build has
// NO runtime fetch/dynamic-import: the URDF is primitive-only (?raw string), KaTeX
// fonts inline as base64 data URIs (assetsInlineLimit via useRecommendedBuildConfig),
// and vite-plugin-singlefile folds every JS/CSS chunk into one inline <script>/<style>.
export default defineConfig(({ mode }) => {
  const singlefile = mode === 'singlefile'
  return {
    base: './',
    plugins: [
      slidesPlugin(),
      katexWoff2Only(),
      ...(singlefile
        ? [
            viteSingleFile({ removeViteModuleLoader: true, useRecommendedBuildConfig: true }),
            renameOfflineHtml(),
          ]
        : []),
    ],
    build: singlefile ? { outDir: OFFLINE_DIR } : {},
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
      strictPort: true,
    },
  }
})
