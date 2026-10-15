import { describe, expect, it } from 'vitest'
import { isPanelOrigin } from './panel-origin'

const PAGES = 'adamleon.github.io'

describe('isPanelOrigin', () => {
  it('accepts VS Code webviews wherever the runtime is served', () => {
    for (const origin of ['vscode-webview://1a2b3c', 'https://0d1e2f.vscode-cdn.net']) {
      expect(isPanelOrigin(origin, PAGES), origin).toBe(true)
      expect(isPanelOrigin(origin, 'localhost'), origin).toBe(true)
    }
  })

  it('accepts local test pages only for a locally served runtime', () => {
    for (const origin of ['http://037vtuv6ip8mucte.localhost:3000', 'http://localhost:3000', 'http://127.0.0.1:4174']) {
      expect(isPanelOrigin(origin, 'localhost'), origin).toBe(true)
      expect(isPanelOrigin(origin, PAGES), origin).toBe(false)
    }
  })

  it('refuses everything else', () => {
    for (const origin of [
      'https://example.com',
      'https://vscode-cdn.net.example.com',
      'http://x.vscode-cdn.net',
      'https://adamleon.github.io',
      'https://localhost.example.com',
      'null',
      '',
    ]) {
      expect(isPanelOrigin(origin, 'localhost'), origin).toBe(false)
    }
  })
})
