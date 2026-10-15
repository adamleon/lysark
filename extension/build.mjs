// Bundles the extension into one file that runs in desktop VS Code and in the
// browser (vscode.dev, github.dev). The engine parts it uses (slide ranges, the
// camera edit, and the yaml package) come from the engine folder above.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['vscode'],
  minify: true,
  logLevel: 'info',
})
