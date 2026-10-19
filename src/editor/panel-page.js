// The Lysark panel's page in VS Code (lysark-v2.md §5, step 3), shared by the
// extension, which shows it, and scripts/check-editor.mjs, which tests it.
// Plain JavaScript, so the boot check can run it in Node without a build.
//
// The panel IS the editor page: it loads the runtime's script and style files
// straight from the course site. It can't frame the site's page instead: in
// github.dev the panel is cross-origin isolated (COEP), and a framed page must
// then send headers GitHub Pages can't send. Files fetched with CORS are fine,
// and Pages answers every request with `Access-Control-Allow-Origin: *`.

/**
 * The version of the messages between the extension and the runtime. Both
 * sides check it, so a course on an older or newer engine than the extension
 * expects gets a clear message instead of a blank panel. The site's editor
 * page states it too (editor.html), so the extension can tell before loading.
 * Raise it whenever the messages change.
 *
 * Version 3 (engine v2.4.0, extension 0.3.0) makes the extension a plain host
 * (docs/editor-host.md): the editing code runs in the panel, so changing how
 * slides are split or the camera is written no longer needs a new version.
 * Version 2 (engine v2.3.x) had the extension write saved views itself; the
 * extension still speaks it, for courses that haven't updated their engine.
 */
export const EDITOR_PROTOCOL = 3

/**
 * The message version the site's editor page states, or null if it states
 * none (engine v2.2.0, the iframe version, did not).
 * @param {string} indexHtml
 * @returns {number | null}
 */
export function editorProtocol(indexHtml) {
  const tag = indexHtml.match(/<meta\b[^>]*\bname\s*=\s*["']lysark-editor-protocol["'][^>]*>/i)?.[0]
  const value = tag?.match(/\bcontent\s*=\s*["'](\d+)["']/i)?.[1]
  return value === undefined ? null : Number(value)
}

/**
 * The runtime's script and style files, from the site's _lysark/editor/index.html,
 * as absolute URLs. Only files under `base` are taken.
 * @param {string} indexHtml
 * @param {string} base the editor's address, ending in `/`
 * @returns {{ scripts: string[], styles: string[] }}
 */
export function editorAssets(indexHtml, base) {
  const inside = (ref) => {
    const url = new URL(ref, base)
    if (!url.href.startsWith(base)) throw new Error(`the editor page refers to a file outside ${base}: ${ref}`)
    return url.href
  }
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
  const scripts = []
  const styles = []
  for (const [tag] of indexHtml.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(tag, 'src')
    if (src && /type\s*=\s*["']module["']/i.test(tag)) scripts.push(inside(src))
  }
  for (const [tag] of indexHtml.matchAll(/<link\b[^>]*>/gi)) {
    const href = attr(tag, 'href')
    if (href && /rel\s*=\s*["']stylesheet["']/i.test(tag)) styles.push(inside(href))
  }
  if (scripts.length === 0) throw new Error(`no editor script found at ${base}`)
  return { scripts, styles }
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A panel page that only shows a line of text, with no scripts: while the
 * extension reads the site, and when it can't.
 * @param {string} text
 * @returns {string}
 */
export function messagePage(text) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
</head>
<body style="margin:0;padding:0">
<div style="position:fixed;inset:0;display:grid;place-items:center;color:var(--vscode-descriptionForeground);font:14px system-ui,sans-serif;text-align:center;padding:24px;white-space:pre-wrap">${escapeAttr(text)}</div>
</body>
</html>`
}

/**
 * The panel's HTML. Its Content-Security-Policy lets scripts run only from the
 * editor's own folder on the course site, so script in lecture text, such as an
 * `onclick` attribute, never runs. Styles may be inline: lecture HTML, KaTeX
 * and the runtime use style attributes (so no nonce in style-src, which would
 * switch 'unsafe-inline' off). Images only from data: and blob: URLs: an image
 * fetched from the site without CORS is blocked in the isolated panel anyway.
 * Every file is fetched with CORS (`crossorigin`), which the isolation requires.
 * @param {{ base: string, scripts: string[], styles: string[], render?: number }} page
 *   `render` makes each page differ, so setting it again reloads the panel, and
 *   the runtime names it in 'ready', so a late 'ready' from an older page is
 *   told apart
 * @returns {string}
 */
export function panelPage({ base, scripts, styles, render = 0 }) {
  const csp = [
    "default-src 'none'",
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `font-src ${base} data:`,
    'img-src data: blob:',
    `connect-src ${base}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const host = new URL(base).host
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="lysark-render" content="${Number(render)}">
${styles.map((href) => `<link rel="stylesheet" crossorigin href="${escapeAttr(href)}">`).join('\n')}
${scripts.map((src) => `<script type="module" crossorigin src="${escapeAttr(src)}"></script>`).join('\n')}
</head>
<body style="margin:0;padding:0">
<div id="lysark-loading" style="position:fixed;inset:0;display:grid;place-items:center;color:var(--vscode-descriptionForeground);font:14px system-ui,sans-serif;text-align:center;padding:24px">Loading the Lysark editor from ${escapeAttr(host)}…</div>
<div id="scene-layer"></div>
<div id="overlay-layer"></div>
</body>
</html>`
}
