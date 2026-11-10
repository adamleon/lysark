import type { ModelRef } from '../compiler/compile-slides'
import { MODEL_SIZE_ADVICE, modelSizeProblem, modelWhere } from '../compiler/model-types'
import { checkModel } from '../scene/model-check'
import { decodeBase64, firstLine } from '../scene/models'
import type { HostFile } from './host'

/**
 * Models in the panel (docs/scene-files.md, "Models"). The compiler reports
 * the model of each object in a scene some slide runs; the panel asks VS Code
 * for the files, as it does for images (panel-images.ts), and checks each with
 * the build's own checks (src/scene/model-check.ts), so a model the panel
 * leaves out names the problem the build would fail on, at the same line of
 * the scene file. A path VS Code won't read (extension 0.3.0) the build
 * refuses too: the compiler a hidden name, a `~1` short name or a ':'
 * (modelPathProblem), and the build a path through a link
 * (vite-plugin-slides.ts). Letter case is the one difference left, as for
 * images. On Windows (and macOS) VS Code finds `Bracket.stl` for
 * `bracket.stl`, so the panel shows a model the build refuses. And a path
 * that comes back in other letter case (`../../Assets/x.stl`) the panel
 * calls outside the lecture folder, where the build says the case is wrong.
 */

/** how many bytes base64 of this length holds, without decoding it */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor(((base64.length - padding) * 3) / 4)
}

/** the path read for a model: its src as written, from the lecture folder */
const pathOf = (src: string) => src.replace(/^(\.\/)+/, '')

/**
 * The path `path` names if it was written from scenes/, where the scene file
 * is, as the host reads a path (each `..` takes off a folder).
 */
function fromScenes(path: string): string {
  const parts = ['scenes']
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/** the host found no file at the path, or refused one outside the lecture folder and assets/ */
function notThere(file: HostFile | undefined): boolean {
  if (typeof file?.base64 === 'string') return false
  const error = file?.error ?? 'not found'
  return error === 'not found' || error.startsWith('outside')
}

/**
 * Why a file VS Code didn't give can't be shown, in the build's words where
 * it has them (vite-plugin-slides.ts), and otherwise in the host's. `fix` is
 * the path from the lecture folder of a file that is there when the path is
 * read from scenes/.
 */
function unreadProblem(src: string, error: string, fix: string | undefined): string {
  const hint = fix ? `. Write ${fix}: the path is from the lecture folder, not from scenes/` : ''
  if (error === 'not found') {
    return `the model '${src}' was not found. Paths in scene files are from the lecture folder, where slides.md is, as for images${hint}`
  }
  // VS Code reads at most 32 MB of a file: one larger is far over lysark's own limit
  if (error.startsWith('larger than')) return `the model is ${error}; ${MODEL_SIZE_ADVICE}`
  return `the model '${src}': ${error}${hint}`
}

/**
 * What is wrong with a file's base64 for the objects that show it, named at
 * the first object it is wrong for; null if all of them can show it.
 */
async function contentProblem(base64: string, uses: ModelRef[]): Promise<string | null> {
  // the size first, so a file far over the limit is never decoded
  const size = modelSizeProblem(base64Bytes(base64))
  if (size) return `${modelWhere(uses[0])}: ${size}`
  try {
    const buffer = decodeBase64(base64)
    // each object reads the file in its own unit: a problem names the first
    // object with the unit it is about, at its own line, as the build does
    for (const unit of new Set(uses.map((ref) => ref.unit))) {
      const user = uses.find((ref) => ref.unit === unit)!
      const problem = await checkModel(buffer, user.format, [unit])
      if (problem) return `${modelWhere(user)}: ${problem}`
    }
    return null
  } catch (error) {
    // the checks catch the loaders' errors; this is a file that isn't base64, or
    // a check that threw: the model is left out, and the panel starts anyway
    return `${modelWhere(uses[0])}: the model couldn't be read: ${firstLine(error)}`
  }
}

/**
 * The model files as base64, by src, from files read with `read`, for the
 * deck's model loader (deck-from-source.ts); and the problems with those it
 * leaves out, each starting where the scene file names it
 * (`scenes/arm.yaml, line 12: object 'bracket': …`). Their objects are drawn
 * as empty nodes. Never rejects, so a model can't keep the panel from starting.
 */
export async function loadModels(
  refs: ModelRef[],
  read: (paths: string[]) => Promise<Record<string, HostFile>>,
): Promise<{ files: Record<string, string>; problems: string[] }> {
  const files: Record<string, string> = {}
  const problems: string[] = []
  // by the path read, in the order the scene files first show each
  const users = new Map<string, ModelRef[]>()
  for (const ref of refs) {
    const path = pathOf(ref.src)
    if (!users.has(path)) users.set(path, [])
    users.get(path)!.push(ref)
  }
  if (users.size === 0) return { files, problems }
  const got = await read([...users.keys()])
  // a file not where its path says may be where the path says read from scenes/:
  // asked for only then, so a lecture whose models are all there makes one request
  const missing = [...users.keys()].filter((path) => notThere(got[path]))
  const fromThere = missing.length > 0 ? await read(missing.map(fromScenes)) : {}
  for (const [path, uses] of users) {
    const file = got[path]
    if (typeof file?.base64 !== 'string') {
      const there = fromScenes(path)
      const fix = notThere(file) && typeof fromThere[there]?.base64 === 'string' ? there : undefined
      problems.push(`${modelWhere(uses[0])}: ${unreadProblem(uses[0].src, file?.error ?? 'not found', fix)}`)
      continue
    }
    const problem = await contentProblem(file.base64, uses)
    if (problem) {
      problems.push(problem)
      continue
    }
    for (const { src } of uses) files[src] = file.base64
  }
  return { files, problems }
}
