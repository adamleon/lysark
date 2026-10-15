/**
 * Which pages may drive the editor runtime: VS Code's webviews, which are
 * `vscode-webview://` in desktop VS Code and `*.vscode-cdn.net` in vscode.dev
 * and github.dev. A local page (`localhost`, `*.localhost`, as @vscode/test-web
 * uses) may only drive a runtime that is itself served locally, so no page on
 * the author's own PC can drive the published one.
 *
 * This is the first of two locks. The runtime shows the HTML in the lecture
 * text it is sent, and VS Code's public webview host lets any site get its own
 * `*.vscode-cdn.net` page, so the origin alone can't be trusted. The second lock
 * is editor.html's Content-Security-Policy, which lets no script run except the
 * runtime's own files, whoever sends the text.
 */
export function isPanelOrigin(origin: string, selfHostname: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol === 'vscode-webview:') return true
  if (url.protocol === 'https:' && url.hostname.endsWith('.vscode-cdn.net')) return true
  if (url.protocol === 'http:' || url.protocol === 'https:') return isLocal(url.hostname) && isLocal(selfHostname)
  return false
}

function isLocal(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  )
}
