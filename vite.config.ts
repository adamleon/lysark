import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { slidesPlugin } from './vite-plugin-slides'

const OFFLINE_DIR = 'dist-offline'
const OFFLINE_HTML = 'lysark-offline.html'

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
