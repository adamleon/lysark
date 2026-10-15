// Serves a built editor runtime the way GitHub Pages serves a course site:
// under /_lysark/editor/, with `Access-Control-Allow-Origin: *` and no
// cross-origin isolation headers of its own. The boot check
// (scripts/check-editor.mjs) uses it, and so can local extension testing:
//
//   node scripts/editor-server.mjs dist/editor 4173
//   → http://127.0.0.1:4173/_lysark/editor/
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EDITOR_PREFIX = '/_lysark/editor/'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** start serving `editorDir` on 127.0.0.1 (port 0 picks a free one); resolves to the server */
export async function serveEditor(editorDir, port = 0) {
  const root = resolve(editorDir)
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let path
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      res.writeHead(400, { 'access-control-allow-origin': '*' }).end() // a malformed %-escape
      return
    }
    // the folder without its slash leads into it, as on Pages; the server's top
    // leads there too, for convenience
    if (path === '/' || path === EDITOR_PREFIX.slice(0, -1)) {
      res.writeHead(302, { location: EDITOR_PREFIX + url.search, 'access-control-allow-origin': '*' }).end()
      return
    }
    const rel = path.startsWith(EDITOR_PREFIX) ? path.slice(EDITOR_PREFIX.length) || 'index.html' : null
    const file = rel === null ? null : normalize(join(root, rel))
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }
    if (!file || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, headers).end()
      return
    }
    res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise((done) => server.listen(port, '127.0.0.1', done))
  return server
}

export function stopServer(server) {
  server.closeAllConnections()
  server.close()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir = 'dist/editor', port = '4173'] = process.argv.slice(2)
  const server = await serveEditor(dir, Number(port))
  console.log(`Serving ${resolve(dir)} at http://127.0.0.1:${server.address().port}${EDITOR_PREFIX}`)
}
