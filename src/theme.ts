/**
 * Colours live in one place: the CSS tokens at the top of styles.css. Scripts
 * that need a colour (the 3D background, plot lines, traces) read the token at
 * the moment they draw, never at import time, so the theme is already set.
 *
 * The print theme (white page and 3D background, dark text, darker accents)
 * overrides the tokens. The PDF export turns it on before the deck starts, by
 * setting `window.__LYSARK_THEME__ = 'print'`; `?theme=print` in the address
 * does the same, for previewing the print look in `lysark dev`.
 */

declare global {
  interface Window {
    __LYSARK_THEME__?: string
  }
}

export type ThemeName = 'screen' | 'print'

/** call first thing at startup, before anything reads a colour */
export function initTheme(): ThemeName {
  const requested = window.__LYSARK_THEME__ ?? new URLSearchParams(location.search).get('theme')
  const theme: ThemeName = requested === 'print' ? 'print' : 'screen'
  if (theme === 'print') document.documentElement.dataset.theme = 'print'
  return theme
}

/** a colour token's current value, such as themeColor('--bg') → '#17161b' */
export function themeColor(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!value) {
    // a missing token is a bug; the offline check fails on console errors
    console.error(`theme: CSS colour token ${token} is not defined in styles.css`)
    return '#888888'
  }
  return value
}
