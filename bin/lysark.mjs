#!/usr/bin/env node
// The `lysark` command (lysark-v2.md §3). Run it from a course repo, where
// lectures live in ./lectures/<name>/slides.md, or from the engine repo, whose
// ./lectures/demo is the engine's test lecture.
import { basename, join } from 'node:path'
import { buildEditor, buildLecture, devServer, lecturesIn, resolveLecture } from '../scripts/lectures.mjs'

const HELP = `Usage: lysark <command>

  dev [lecture]              Preview a lecture in the browser; it updates on every
                             save. Without a lecture, pick one from a list.
  build [lecture...]         Build student files into dist/ (all lectures if none
                             given). Option: --out-dir <dir>
  check <file.html...>       Offline check: open each file from disk in Chromium,
                             step every slide, and fail on any error or request.
  pdf <file.html>            Make the PDF. Option: --out <file.pdf>
  editor-build               Build the editor runtime that the VS Code extension
                             shows. Option: --out-dir <dir> (default dist/editor)

  site --out <dir> [--live <url>]   CI: build changed lectures for GitHub Pages
  site-pdf                           CI: add PDFs for the lectures 'site' rebuilt
  site-status                        CI: fail if any lecture failed

A lecture is a name in ./lectures (baneplanlegging) or a path to a lecture
folder (../ais2105-lectures/lectures/04-x).
'check', 'pdf' and the site commands need Chromium: npx playwright-core install chromium`

function parse(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) options[key] = true
      else options[key] = argv[++i]
    } else positional.push(arg)
  }
  return { positional, options }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, options } = parse(rest)
  const cwd = process.cwd()

  switch (command) {
    case 'dev': {
      let lecture = positional[0] ? resolveLecture(positional[0], cwd) : null
      const all = lecturesIn(cwd)
      if (!lecture && all.length === 1) lecture = all[0]
      await devServer({
        lecturesRoot: lecture?.lecturesRoot ?? join(cwd, 'lectures'),
        courseRoot: lecture?.courseRoot ?? cwd,
        lecture,
      })
      return true
    }

    case 'build': {
      const lectures = positional.length ? positional.map((a) => resolveLecture(a, cwd)) : lecturesIn(cwd)
      if (lectures.length === 0) throw new Error('No lectures found in ./lectures')
      const outDir = typeof options['out-dir'] === 'string' ? options['out-dir'] : 'dist'
      for (const lecture of lectures) {
        const out = join(outDir, `${lecture.name}.html`)
        await buildLecture(lecture, out)
        console.log(`✓ ${out}`)
      }
      return true
    }

    case 'check': {
      if (positional.length === 0) throw new Error('Usage: lysark check <file.html...>')
      const { checkOffline } = await import('../scripts/check-offline.mjs')
      let ok = true
      for (const file of positional) {
        const report = await checkOffline(file)
        console.log(`${report.ok ? '✓' : '✗'} ${file}`)
        for (const line of report.lines) console.log(`   ${line}`)
        ok &&= report.ok
      }
      return ok
    }

    case 'pdf': {
      const file = positional[0]
      if (!file) throw new Error('Usage: lysark pdf <file.html> [--out <file.pdf>]')
      const out = typeof options.out === 'string' ? options.out : file.replace(/\.html?$/i, '') + '.pdf'
      const { exportPdf } = await import('../scripts/export-pdf.mjs')
      const pages = await exportPdf(file, out, (msg) => process.stdout.write(`  ${msg}\r`))
      console.log(`\n✓ ${out} (${pages} pages)`)
      return true
    }

    case 'editor-build': {
      const outDir = typeof options['out-dir'] === 'string' ? options['out-dir'] : join('dist', 'editor')
      await buildEditor(outDir)
      console.log(`✓ ${join(outDir, 'index.html')}`)
      return true
    }

    case 'site': {
      if (typeof options.out !== 'string') throw new Error('Usage: lysark site --out <dir> [--live <url>]')
      const { site } = await import('../scripts/site.mjs')
      const { checkOffline } = await import('../scripts/check-offline.mjs')
      await site({
        courseRoot: cwd,
        out: options.out,
        live: typeof options.live === 'string' && options.live ? options.live : null,
        checkOffline,
      })
      return true
    }

    case 'site-pdf': {
      const { sitePdf } = await import('../scripts/site.mjs')
      const { exportPdf } = await import('../scripts/export-pdf.mjs')
      await sitePdf({ courseRoot: cwd, exportPdf })
      return true
    }

    case 'site-status': {
      const { siteStatus } = await import('../scripts/site.mjs')
      return siteStatus({ courseRoot: cwd })
    }

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return true

    default:
      console.error(`Unknown command '${command}'.\n`)
      console.log(HELP)
      return false
  }
}

main().then(
  (ok) => {
    // dev keeps running; every other command ends here
    if (process.argv[2] !== 'dev') process.exit(ok ? 0 : 1)
  },
  (err) => {
    console.error(`${basename(process.argv[1])}: ${err?.message ?? err}`)
    process.exit(1)
  },
)
