/**
 * The panel's requests to the VS Code extension, messages version 3
 * (docs/editor-host.md). The extension is a plain host: it reads files, lists
 * folders, applies edits and asks the user questions; everything the editor
 * does with them happens here, in the panel, loaded from the course site. So
 * new editor features arrive with the engine, not with an extension release.
 *
 * Each request carries an id, and the extension answers with
 * `{ type: 'lysark:reply', id, … }`. Paths are relative to the lecture folder,
 * written as in slides.md (`images/arm.png`, `scenes/agilus.yaml`); the
 * extension decides what may be read (the lecture folder and the course's
 * assets/ folder) and written (slides.md and scenes/*.yaml).
 */

/** a file as read: text with its document version, base64 bytes, or why not */
export interface HostFile {
  text?: string
  version?: number
  base64?: string
  error?: string
}

/** one change to a file: replace characters start…end of `version`, or create the file */
export type HostChange =
  | { path: string; version: number; start: number; end: number; text: string }
  | { path: string; create: string }

export interface AskItem {
  label: string
  description?: string
  value: string
}

/** a box to type in; the panel checks the answer itself, and asks again with a prompt saying why */
export interface AskInput {
  prompt?: string
  value?: string
  placeholder?: string
}

type Reply = Record<string, unknown> & { id: number }

/** reads and edits answer within this, unless the caller says otherwise; a question waits for the user */
const REPLY_TIMEOUT_MS = 30_000
/** the extension answers at most 64 files per read; ask for fewer at a time */
const READ_CHUNK = 32

/**
 * `page`: this page's render number (panel-page.js). Request ids start from
 * it, so an answer meant for the page this one replaced, arriving late, can't
 * be taken for an answer to this page's request with the same number.
 */
export function createHost(post: (message: Record<string, unknown>) => void, page = 0) {
  const waiting = new Map<number, (reply: Reply | null) => void>()
  let nextId = (Number.isInteger(page) && page > 0 ? page : 0) * 1_000_000 + 1

  function request(type: string, body: Record<string, unknown>, timeoutMs: number | null = REPLY_TIMEOUT_MS): Promise<Reply | null> {
    const id = nextId++
    return new Promise((resolve) => {
      const timer = timeoutMs === null ? undefined : window.setTimeout(() => settle(null), timeoutMs)
      const settle = (reply: Reply | null) => {
        window.clearTimeout(timer)
        waiting.delete(id)
        resolve(reply)
      }
      waiting.set(id, settle)
      post({ type: `lysark:${type}`, id, ...body })
    })
  }

  return {
    /** an answer from the extension; true if it was one */
    onReply(message: { type?: unknown; id?: unknown }): boolean {
      if (message?.type !== 'lysark:reply' || typeof message.id !== 'number') return false
      waiting.get(message.id)?.(message as Reply)
      return true
    },

    /**
     * The files' current contents, unsaved typing included, keyed by the paths
     * asked for. Asked for a few at a time; a file the extension answers
     * `later` (too much together) is asked for again. `timeoutMs` is per request.
     */
    async read(paths: string[], as: 'text' | 'bytes', timeoutMs: number | null = REPLY_TIMEOUT_MS): Promise<Record<string, HostFile>> {
      const out: Record<string, HostFile> = {}
      const queue = [...new Set(paths)]
      while (queue.length > 0) {
        const chunk = queue.splice(0, READ_CHUNK)
        const reply = await request('read', { paths: chunk, as }, timeoutMs)
        const files = (reply?.files ?? {}) as Record<string, HostFile & { later?: boolean }>
        const later = chunk.filter((path) => files[path]?.later)
        // the extension answers the first file of each request, so this ends
        const asked = later.length < chunk.length ? later : []
        for (const path of chunk) {
          if (asked.includes(path)) continue
          const file = files[path]
          out[path] = file && !file.later ? file : { error: reply ? 'no answer for this file' : 'VS Code did not answer' }
        }
        queue.unshift(...asked)
      }
      return out
    },

    /** a folder's entries; null if it can't be listed */
    async list(dir: string): Promise<Array<{ name: string; dir: boolean }> | null> {
      const reply = await request('list', { dir })
      return Array.isArray(reply?.entries) ? (reply.entries as Array<{ name: string; dir: boolean }>) : null
    },

    /**
     * Apply the changes as one edit. Refused as a whole if a file changed since
     * the version the change was computed on, or isn't one the panel may write.
     */
    async edit(label: string, changes: HostChange[]): Promise<{ ok: boolean; message?: string }> {
      const reply = await request('edit', { label, changes })
      if (!reply) return { ok: false, message: 'VS Code did not answer' }
      return { ok: reply.ok === true, message: typeof reply.message === 'string' ? reply.message : undefined }
    },

    /** a choice from `items`, or text typed into `input`; null if the user cancelled */
    async ask(question: { title: string; items?: AskItem[]; input?: AskInput }): Promise<string | null> {
      const reply = await request('ask', question, null)
      return typeof reply?.value === 'string' ? reply.value : null
    },
  }
}

export type Host = ReturnType<typeof createHost>
