// playwright-core ships no browser (lysark-v2.md §3): CI installs Chromium with
// `npx playwright-core install --with-deps chromium`, laptops normally never do.
import { chromium } from 'playwright-core'

export async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    // only the missing-browser case gets the friendly hint; any other launch
    // failure (missing system libraries, a crash) keeps its own message and logs
    if (/Executable doesn't exist/i.test(String(err?.message))) {
      throw new Error(
        'Chromium is not installed. The offline check and the PDF normally run in CI.\n' +
          'To run them on this computer, install Chromium once with:\n' +
          '  npx playwright-core install chromium',
        { cause: err },
      )
    }
    throw err
  }
}
