import type { ModelRef } from '../compiler/compile-slides'
import type { SceneFile } from '../compiler/scene-files'
import { modelObjectKey, modelReadWay, modelSizeAdvice, modelSizeProblem, modelWhere } from '../compiler/model-types'
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

/** the host's answer for a file over what VS Code's editor reads, `larger than 32 MB` (extension 0.3.0 and 0.4.0, MAX_READ_BYTES) */
const TOO_LARGE = /^larger than (.+)$/

/**
 * Why a file VS Code didn't give can't be shown, in the build's words where
 * it has them (vite-plugin-slides.ts), and otherwise in the host's. `fix` is
 * the path from the lecture folder of a file that is there when the path is
 * read from scenes/.
 *
 * VS Code's editor reads at most 32 MB of a file (the extension's own limit,
 * which the panel can't lift), and says only that, not the size. Without
 * limits: off such a file is far over lysark's own limit too, and gets its
 * advice; with it, its size doesn't stop the build, and only the preview
 * can't show it. Only that is said: the panel never saw the bytes, so it
 * can't tell whether the build passes the rest of the file.
 */
function unreadProblem(ref: ModelRef, error: string, fix: string | undefined): string {
  const hint = fix ? `. Write ${fix}: the path is from the lecture folder, not from scenes/` : ''
  if (error === 'not found') {
    return `the model '${ref.src}' was not found. Paths in scene files are from the lecture folder, where slides.md is, as for images${hint}`
  }
  const tooLarge = TOO_LARGE.exec(error)
  if (tooLarge) {
    const preview = `the model '${ref.src}' is ${error}: VS Code's editor reads at most ${tooLarge[1]} per file, so the preview can't show it`
    return ref.limits === 'off'
      ? `${preview}. Its size doesn't stop the build, because its scene file says limits: off`
      : `${preview}. The lecture doesn't build with it either: ${modelSizeAdvice(ref.format)}`
  }
  return `the model '${ref.src}': ${error}${hint}`
}

/**
 * What is wrong with a file's base64 for the objects that show it: a problem
 * for each way they read it (unit, look and limits: modelReadWay) that
 * fails, named at the first object that reads it so, at its own line, as the
 * build does; and the objects it can't be shown for. A file over the size
 * limit is so for every object whose scene file keeps the limits, named at
 * the first of them; and the file itself wrong, for all of them.
 */
async function contentProblems(base64: string, uses: ModelRef[]): Promise<{ problems: string[]; refused: Set<ModelRef> }> {
  const problems: string[] = []
  const refused = new Set<ModelRef>()
  const refuse = (readers: ModelRef[], problem: string) => {
    problems.push(`${modelWhere(readers[0])}: ${problem}`)
    for (const ref of readers) refused.add(ref)
  }
  // the size first, so a file far over the limit is never decoded for the objects it is too large for
  const limited = uses.filter((ref) => ref.limits === 'on')
  const size = limited.length > 0 ? modelSizeProblem(base64Bytes(base64), limited[0].format, 'on') : null
  if (size) refuse(limited, size)
  const rest = uses.filter((ref) => !refused.has(ref))
  if (rest.length === 0) return { problems, refused }
  let buffer: ArrayBuffer
  try {
    buffer = decodeBase64(base64)
  } catch (error) {
    // the host never sends what isn't base64: the model is left out, and the panel starts anyway
    refuse(rest, `the model couldn't be read: ${firstLine(error)}`)
    return { problems, refused }
  }
  for (const way of new Set(rest.map(modelReadWay))) {
    const readers = rest.filter((ref) => modelReadWay(ref) === way)
    let problem: string | null
    try {
      problem = await checkModel(buffer, readers[0].format, [readers[0].unit], readers[0].look, readers[0].src, readers[0].limits)
    } catch (error) {
      // the checks catch the loaders' errors; this is a check that threw
      problem = `the model couldn't be read: ${firstLine(error)}`
    }
    if (problem === null) continue
    problems.push(`${modelWhere(readers[0])}: ${problem}`)
    for (const ref of readers) refused.add(ref)
  }
  return { problems, refused }
}

/**
 * True when a scene file with models says limits: off in one set of the
 * lecture's scene files (readSceneFiles) and not in the other. The panel
 * checked its models in their files' limits when it loaded, so new text
 * that changes only that line can't go into the running deck in place, as
 * text that moves objects can (runtime.ts, updateInPlace): only loading the
 * panel afresh checks them again.
 */
export function limitsChanged(before: Map<string, SceneFile>, after: Map<string, SceneFile>): boolean {
  const limits = (files: Map<string, SceneFile>) =>
    JSON.stringify(
      [...files.values()]
        .filter((file) => file.models.length > 0)
        .map((file) => `${file.path} ${file.limits}`)
        .sort(),
    )
  return limits(before) !== limits(after)
}

/**
 * The model files as base64, by src, from files read with `read`, for the
 * deck's model loader (deck-from-source.ts); the problems with those it
 * leaves out, each starting where the scene file names it
 * (`scenes/arm.yaml, line 12: object 'bracket': …`); and `leftOut`, the
 * objects (modelObjectKey) that read a file it gives a way that failed,
 * their unit, their look or their scene file's limits, so the loader shows
 * the file only to the others: one object without its material: line
 * doesn't take the file from another with a colour, nor one in a scene file
 * that keeps the size limits from one in a file with limits: off. The
 * objects left out are drawn as empty nodes. Never rejects, so a model can't
 * keep the panel from starting.
 */
export async function loadModels(
  refs: ModelRef[],
  read: (paths: string[]) => Promise<Record<string, HostFile>>,
): Promise<{ files: Record<string, string>; problems: string[]; leftOut: string[] }> {
  const files: Record<string, string> = {}
  const problems: string[] = []
  const leftOut = new Set<string>()
  // by the path read, in the order the scene files first show each
  const users = new Map<string, ModelRef[]>()
  for (const ref of refs) {
    const path = pathOf(ref.src)
    if (!users.has(path)) users.set(path, [])
    users.get(path)!.push(ref)
  }
  if (users.size === 0) return { files, problems, leftOut: [] }
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
      const error = file?.error ?? 'not found'
      // one line for the file, at its first object; for one too large for VS Code, at the
      // first whose scene file keeps the limits, if any does: that is where the build stops
      const named = (TOO_LARGE.test(error) && uses.find((ref) => ref.limits === 'on')) || uses[0]
      problems.push(`${modelWhere(named)}: ${unreadProblem(named, error, fix)}`)
      continue
    }
    const content = await contentProblems(file.base64, uses)
    problems.push(...content.problems)
    const shown = uses.filter((ref) => !content.refused.has(ref))
    if (shown.length === 0) continue
    for (const { src } of shown) files[src] = file.base64
    for (const ref of content.refused) leftOut.add(modelObjectKey(ref))
  }
  return { files, problems, leftOut: [...leftOut] }
}
