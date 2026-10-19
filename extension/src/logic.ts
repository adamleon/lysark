/**
 * The extension's pure parts, kept apart from the vscode API so the engine's
 * tests can run them.
 */

export { matchSlide, singleEdit } from '../../src/editor/slide-match'

/**
 * Text for a VS Code notification. VS Code turns `[label](command:…)` (or
 * https:, file:) in an extension's message into a link that runs or opens it
 * when clicked, even in Restricted Mode; messages here carry text from the
 * workspace and the course site. Breaking `](` keeps the text readable and
 * makes no link.
 */
export function notificationText(text: string): string {
  return text.replace(/\]\s*\(/g, '] (')
}

/** the folder the course site publishes the editor runtime in (scripts/site.mjs) */
export const EDITOR_PATH = '_lysark/editor/'

/**
 * Where to load the editor runtime from, as a folder address ending in `/`:
 * the `lysark.editorUrl` setting if set, otherwise the course package.json's
 * `homepage` (its GitHub Pages address) plus `_lysark/editor/`. Throws with a
 * message for the author if neither works.
 */
export function editorUrl(setting: string, packageJson: unknown): string {
  const fromSetting = setting.trim()
  if (fromSetting) return checkedFolder(fromSetting, 'The lysark.editorUrl setting')
  const homepage = (packageJson as { homepage?: unknown } | null)?.homepage
  if (typeof homepage !== 'string' || !homepage.trim()) {
    throw new Error(
      "The course's package.json has no \"homepage\". Add the course's GitHub Pages address, " +
        'for example "homepage": "https://adamleon.github.io/ais2105-lectures/".',
    )
  }
  const site = checkedFolder(homepage.trim(), 'The "homepage" in package.json')
  return new URL(EDITOR_PATH, site).href
}

/** a web address as a folder: https (or http on this computer), no query, ending in `/` */
function checkedFolder(text: string, what: string): string {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error(`${what} is not a web address: ${text}`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    throw new Error(`${what} must start with https:// (got ${text})`)
  }
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  // the address goes into the panel's Content-Security-Policy, where these
  // characters would end or split it
  if (/[\s;,'"]/.test(url.href)) throw new Error(`${what} contains a character it can't have: ${text}`)
  return url.href
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/** a saved view as the runtime sends it: lookAt is a point or an anchor name */
export function isCameraView(v: unknown): v is { lookAt: [number, number, number] | string; offset: [number, number, number] } {
  const view = v as { lookAt?: unknown; offset?: unknown } | null
  return !!view && typeof view === 'object' && isVec3(view.offset) && (typeof view.lookAt === 'string' || isVec3(view.lookAt))
}

/** true if package.json belongs to a Lysark course (it depends on the engine) */
export function isCoursePackage(packageJson: unknown): boolean {
  const deps = (packageJson as { dependencies?: Record<string, unknown> } | null)?.dependencies
  return !!deps && typeof deps === 'object' && 'lysark' in deps
}

// ---- the host's rules for message version 3 (read, list, edit) -------------

/**
 * Where a path the panel asked for points, as a folder path (`uri.path`
 * style, forward slashes): `rel` is relative to the lecture folder, like an
 * image path in slides.md. null unless it is one of `roots` or lands inside
 * one (the lecture folder, and the course's assets/ folder when the course is
 * known). Refuses absolute paths, backslashes, colons (drive letters, and
 * Windows' alternate data streams) and hidden names (`.git`, `.env`, also by
 * their Windows short names such as `GIT~1`); an empty
 * segment counts as none, as in the course build. Only the text of the path:
 * links are the caller's to check.
 */
export function resolveInside(lectureDir: string, rel: string, roots: string[]): string | null {
  if (!rel || rel.startsWith('/') || /[\\:\0]/.test(rel)) return null
  const parts = lectureDir.replace(/\/+$/, '').split('/')
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment.startsWith('.') && segment !== '..') return null
    // a Windows short name (`ENV~1` for `.env`) reaches a hidden file by another name
    if (/~\d/.test(segment)) return null
    if (segment === '..') {
      if (parts.length <= 1) return null
      parts.pop()
    } else parts.push(segment)
  }
  const path = parts.join('/')
  return roots.some((root) => {
    const dir = root.replace(/\/+$/, '')
    return path === dir || path.startsWith(dir + '/')
  })
    ? path
    : null
}

/** a file the panel may change: the lecture's slides.md, or one of its scene files */
export function isWritablePath(rel: string): boolean {
  return rel === 'slides.md' || /^scenes\/[a-z][a-z0-9-]*\.ya?ml$/.test(rel)
}

/** a file the panel may create: a new scene file */
export function isCreatablePath(rel: string): boolean {
  return /^scenes\/[a-z][a-z0-9-]*\.yaml$/.test(rel)
}

/**
 * The panel's include patterns (`scenes/*.yaml`): one folder below the lecture
 * folder and a `*` file name with a YAML extension, the only form supported
 * (the files are sent as text with every update). Returns the folders to list,
 * and a test for a path relative to the lecture folder.
 */
export function includePatterns(patterns: unknown): { dirs: string[]; matches: (rel: string) => boolean } {
  const rules: Array<{ dir: string; ext: string }> = []
  for (const p of Array.isArray(patterns) ? patterns.slice(0, 16) : []) {
    const m = typeof p === 'string' ? p.match(/^([a-z][a-z0-9-]*)\/\*(\.ya?ml)$/) : null
    if (m) rules.push({ dir: m[1], ext: m[2] })
  }
  const matches = (rel: string): boolean => {
    const slash = rel.indexOf('/')
    const dir = rel.slice(0, slash)
    const name = rel.slice(slash + 1)
    if (slash < 0 || name.includes('/') || name.startsWith('.')) return false
    return rules.some((r) => r.dir === dir && name.length > r.ext.length && name.endsWith(r.ext))
  }
  return { dirs: [...new Set(rules.map((r) => r.dir))], matches }
}

/**
 * What went wrong with a file, for the panel: a short reason from the error's
 * code, never its message, which can hold the absolute path on this computer
 * (and so the user name).
 */
export function fileProblem(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  const reasons: Record<string, string> = {
    FileNotFound: 'not found',
    EntryNotFound: 'not found',
    FileNotADirectory: 'not a folder',
    EntryNotADirectory: 'not a folder',
    FileIsADirectory: 'a folder, not a file',
    EntryIsADirectory: 'a folder, not a file',
    FileExists: 'already exists',
    EntryExists: 'already exists',
    NoPermissions: 'no permission',
    Unavailable: 'unavailable',
  }
  return (typeof code === 'string' && reasons[code]) || 'could not be read'
}

/** bytes as base64, in both extension hosts (the web one has no Buffer) */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
