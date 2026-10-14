import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slidesPlugin } from './vite-plugin-slides'
import { lecturePlugin } from './vite-plugin-lecture'

// The engine's own folder: index.html, src/, and the scenes live here, also
// when the engine is installed under a course's node_modules.
const ENGINE_ROOT = dirname(fileURLToPath(import.meta.url))

// Set by bin/lysark.mjs (lysark-v2.md §3). Without them, the engine's own
// lectures/ folder is used, which is what the engine's tests and dev use.
const LECTURES_ROOT = process.env.LYSARK_LECTURES_ROOT || join(ENGINE_ROOT, 'lectures')
const LECTURE = process.env.LYSARK_LECTURE || null
const COURSE_ROOT = process.env.LYSARK_COURSE_ROOT || ENGINE_ROOT

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

// `lysark build` produces one self-contained HTML file per lecture, the student
// file (lysark-v2.md §2). vite-plugin-singlefile folds every JS/CSS chunk into
// one inline <script>/<style>, and KaTeX fonts inline as base64 data URIs, so
// the file has no runtime fetch or dynamic import (lysark-design.md §9).
export default defineConfig(({ command }) => ({
  root: ENGINE_ROOT,
  base: './',
  publicDir: false,
  cacheDir: join(COURSE_ROOT, 'node_modules', '.vite'),
  plugins: [
    slidesPlugin({ courseRoot: COURSE_ROOT }),
    lecturePlugin({ engineRoot: ENGINE_ROOT, lecturesRoot: LECTURES_ROOT, lecture: LECTURE }),
    katexWoff2Only(),
    ...(command === 'build'
      ? [viteSingleFile({ removeViteModuleLoader: true, useRecommendedBuildConfig: true })]
      : []),
  ],
  // the engine runs from inside the course's node_modules, so its own source
  // isn't crawled for dependencies; list them so dev doesn't re-optimize mid-load
  optimizeDeps: {
    include: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'three/addons/loaders/ColladaLoader.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'urdf-loader',
      'uplot',
    ],
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: !!process.env.PORT,
    fs: { allow: [ENGINE_ROOT, LECTURES_ROOT, COURSE_ROOT] },
  },
}))
