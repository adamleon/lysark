// playwright-core ships no browser (lysark-v2.md §3): CI installs Chromium with
// `npx playwright-core install --with-deps chromium`, laptops normally never do.
import { chromium, firefox } from 'playwright-core'

export function launchChromium() {
  return launchBrowser('chromium')
}

/** 'chromium' or 'firefox' (the editor check runs in both) */
export async function launchBrowser(name, { headed = false } = {}) {
  const browserType = { chromium, firefox }[name]
  if (!browserType) throw new Error(`unknown browser '${name}' (chromium or firefox)`)
  try {
    return await browserType.launch({
      headless: !headed,
      timeout: 60_000,
      // CI machines have no GPU, and Firefox's graphics blocklist then refuses
      // WebGL 2 ("AllowWebgl2:false restricts context creation on this
      // system"); Chromium falls back to software rendering on its own
      ...(name === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true } } : {}),
      // On Windows, headless Chromium's default start renders WebGL with
      // ANGLE's SwiftShader too, but loses every page's WebGL context once,
      // in its first seconds, and three.js logs an error for each shader it
      // links meanwhile, which fails the checks at random (Playwright's
      // Chromium 1228, an AMD Radeon 890M laptop, 2026-11-25). Naming that
      // backend gives the same renderer without the loss
      ...(name === 'chromium' && process.platform === 'win32' ? { args: ['--use-angle=swiftshader'] } : {}),
    })
  } catch (err) {
    // only the missing-browser case gets the friendly hint; any other launch
    // failure (missing system libraries, a crash) keeps its own message and logs
    if (/Executable doesn't exist/i.test(String(err?.message))) {
      const display = { chromium: 'Chromium', firefox: 'Firefox' }[name]
      throw new Error(
        `${display} is not installed. The checks and the PDF normally run in CI.\n` +
          'To run them on this computer, install it once with:\n' +
          `  npx playwright-core install ${name}`,
        { cause: err },
      )
    }
    throw err
  }
}
