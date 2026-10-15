import { describe, expect, it } from 'vitest'
import editorHtml from '../../editor.html?raw'
import { EDITOR_PROTOCOL, editorAssets, editorProtocol, messagePage, panelPage } from './panel-page.js'

describe('messagePage', () => {
  it('shows the text escaped, with no scripts allowed', () => {
    const page = messagePage('Could not load <b>x</b> & "y"')
    expect(page).toContain('Could not load &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
    expect(page).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(page).not.toMatch(/<script/i)
  })
})

describe('editorProtocol', () => {
  it('reads the message version the editor page states, which matches the runtime', () => {
    expect(editorProtocol(editorHtml)).toBe(EDITOR_PROTOCOL)
  })

  it('is null for an editor page that states none (engine v2.2.0)', () => {
    expect(editorProtocol('<head><title>Lysark editor</title></head>')).toBeNull()
  })
})

const BASE = 'https://adamleon.github.io/ais2105-lectures/_lysark/editor/'

// what `lysark editor-build` writes (abridged)
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'" />
    <title>Lysark editor</title>
    <script type="module" crossorigin src="./assets/editor-DrdhvwLB.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/editor-Ab12.css">
  </head>
  <body><div id="scene-layer"></div></body>
</html>`

describe('editorAssets', () => {
  it('finds the module scripts and stylesheets as addresses under the editor folder', () => {
    expect(editorAssets(INDEX, BASE)).toEqual({
      scripts: [`${BASE}assets/editor-DrdhvwLB.js`],
      styles: [`${BASE}assets/editor-Ab12.css`],
    })
  })

  it('refuses files outside the editor folder, and a page without a script', () => {
    expect(() => editorAssets('<script type="module" src="https://evil.example/x.js"></script>', BASE)).toThrow(/outside/)
    expect(() => editorAssets('<script type="module" src="../../x.js"></script>', BASE)).toThrow(/outside/)
    expect(() => editorAssets('<html></html>', BASE)).toThrow(/no editor script/)
  })
})

describe('panelPage', () => {
  const page = panelPage({ base: BASE, scripts: [`${BASE}assets/e.js`], styles: [`${BASE}assets/e.css`], render: 3 })

  it('loads the files with CORS, which a cross-origin-isolated panel requires', () => {
    expect(page).toContain(`<script type="module" crossorigin src="${BASE}assets/e.js"></script>`)
    expect(page).toContain(`<link rel="stylesheet" crossorigin href="${BASE}assets/e.css">`)
  })

  it('lets scripts run only from the editor folder, never inline', () => {
    const csp = page.match(/Content-Security-Policy" content="([^"]*)"/)![1]
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe(`script-src ${BASE}`)
    expect(csp).toContain("default-src 'none'")
    expect(page).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })

  it('names its render, so each page differs and a late ready can be told apart', () => {
    expect(page).toContain('<meta name="lysark-render" content="3">')
    expect(panelPage({ base: BASE, scripts: [], styles: [], render: 4 })).not.toBe(
      panelPage({ base: BASE, scripts: [], styles: [], render: 5 }),
    )
  })

  it('takes images only from data: and blob:, which isolation and the policy both allow', () => {
    expect(page).toContain("img-src data: blob:;")
  })
})
