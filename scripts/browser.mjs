// playwright-core ships no browser (lysark-v2.md §3): CI installs Chromium with
// `npx playwright-core install --with-deps chromium`, laptops normally never do.
import { chromium, firefox } from 'playwright-core'

export function launchChromium() {
  return launchBrowser('chromium')
}

/** 'chromium' or 'firefox' (the editor check runs in both) */
export async function launchBrowser(name) {
  const browserType = { chromium, firefox }[name]
  if (!browserType) throw new Error(`unknown browser '${name}' (chromium or firefox)`)
  try {
    return await browserType.launch()
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
