// The open file's comments (common/fileAnnotations.ts): read when a file is opened or changes on
// disk, handed to the editor as marks, and written back to — a reply, a resolve — through the same
// route. Shaped like useFileHeadText next door, which solves the same problem for the change marks:
// cleared the moment another file opens, and an answer that arrives late is dropped.
//
// Nothing is asked of the server unless a declared provider covers this kind of file. Most users
// declare none, and for them this composable is two refs that stay empty.
import { computed, ref, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { CmEditor } from "../components/cmEditor";
import type { AnnotationMark } from "../components/cmAnnotationGutter";
import { browseQuery } from "../components/filesPaneApi";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import {
  providerCoversFile,
  readAnnotationReply,
  readFileAnnotationSets,
  type AnnotationAction,
  type AnnotationProvider,
  type AnnotationThread,
  type FileAnnotationSet,
} from "../../common/fileAnnotations";

/** A thread as the panel shows it: which provider it came from, and a key unique across them. */
export interface ShownThread extends AnnotationThread {
  key: string;
  provider: { id: string; label: string };
}

export interface FileAnnotationsDeps {
  cwd: () => string | null;
  openPath: Ref<string | null>;
  /** Set for a file that is not text; it has no lines to comment on. */
  unpreviewable: Ref<string | null>;
  /** Moves when the file on disk does — a save, or a change from outside. */
  baseVersion: Ref<string | null>;
  editor: ShallowRef<CmEditor | null>;
  /** Bumped on every edit, so a line shown in the panel is asked for again after typing moves it. */
  editSeq: Ref<number>;
  providers: Ref<readonly AnnotationProvider[]>;
}

export interface FileAnnotations {
  threads: Ref<ShownThread[]>;
  /** A provider that failed, in words, beside whatever the others returned. */
  failures: ComputedRef<{ label: string; error: string }[]>;
  /** The providers' instructions for an agent, joined; null for none. */
  instructions: ComputedRef<string | null>;
  /** The thread whose mark was last clicked, for the panel to bring into view. */
  activeKey: Ref<string | null>;
  /** The thread a reply or resolve is in flight for. */
  busyKey: Ref<string | null>;
  /** Why the last reply or resolve did not land. */
  actionError: Ref<string | null>;
  /** Whether anything is declared for the open file — false means the panel has no reason to exist. */
  covered: ComputedRef<boolean>;
  refresh: () => Promise<void>;
  /** True when the reply landed. */
  reply: (key: string, body: string) => Promise<boolean>;
  resolve: (key: string) => Promise<void>;
  /** The line a thread is on now: the editor's, which follows typing, else the provider's. */
  lineOf: (thread: ShownThread) => number | null;
}

const threadKey = (providerId: string, threadId: string): string => `${providerId}:${threadId}`;

/** The sets as one list, placed threads first in line order and unplaced ones after — the order a
 *  reader meets them going down the file. Exported for the spec. */
export function shownThreads(sets: readonly FileAnnotationSet[]): ShownThread[] {
  const all = sets.flatMap((set) => set.threads.map((thread) => ({ ...thread, key: threadKey(set.provider.id, thread.id), provider: set.provider })));
  return all.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
}

/** What the editor is told. `at` puts every thread given on that line instead of its own — where
 *  the editor already has it — keeping the length of its passage. Exported for the spec. */
export function marksFor(threads: readonly ShownThread[], at: number | null = null): AnnotationMark[] {
  return threads.flatMap((thread) =>
    thread.line === null ? [] : [{ line: at ?? thread.line, span: (thread.endLine ?? thread.line) - thread.line + 1, keys: [thread.key] }],
  );
}

const errorOf = (body: Record<string, unknown>, status: number): string => (typeof body.error === "string" && body.error ? body.error : `HTTP ${status}`);

// What the functions below share. They are module-level rather than closures so each stays small
// enough to read whole; this is what they would otherwise have closed over.
interface Ctx {
  deps: FileAnnotationsDeps;
  sets: Ref<FileAnnotationSet[]>;
  threads: Ref<ShownThread[]>;
  activeKey: Ref<string | null>;
  busyKey: Ref<string | null>;
  actionError: Ref<string | null>;
  covered: ComputedRef<boolean>;
  /** Which read is current; an answer for an older one is dropped. */
  read: { id: number };
  // A reply that failed is retried under the SAME id when its words have not changed, so a provider
  // that did store the first one can recognise the second rather than post it twice.
  pendingReplies: Map<string, { body: string; requestId: string }>;
}

const url = (ctx: Ctx, pathRel: string): string => `/api/files/browse/annotations?${browseQuery(ctx.deps.cwd(), pathRel)}`;

/** Tell the editor where the threads are. `keepPlaces` is for a change made HERE (a thread
 *  resolved): the others stay where the reader's typing has carried them. A fresh answer from the
 *  provider does not keep them — its lines are for the file as it is now. */
function pushMarks(ctx: Ctx, keepPlaces: boolean): void {
  const editor = ctx.deps.editor.value;
  if (!editor) return;
  // Read before anything is set: setting replaces the marks these lines are read from.
  const marks = ctx.threads.value.flatMap((thread) => marksFor([thread], keepPlaces ? editor.annotationLine(thread.key) : null));
  editor.setAnnotations(marks, (key) => {
    ctx.activeKey.value = key;
  });
}

function adopt(ctx: Ctx, next: FileAnnotationSet[]): void {
  ctx.sets.value = next;
  ctx.threads.value = shownThreads(next);
  pushMarks(ctx, false);
}

async function refresh(ctx: Ctx): Promise<void> {
  const id = ++ctx.read.id;
  const pathRel = ctx.deps.openPath.value;
  if (!pathRel || !ctx.covered.value) return adopt(ctx, []);
  try {
    const res = await fetchWithTimeout(url(ctx, pathRel), undefined, SLOW_COMMAND_TIMEOUT_MS);
    if (id !== ctx.read.id || ctx.deps.openPath.value !== pathRel) return;
    // A refusal (the file became binary, the folder is gone) leaves nothing to show; the pane
    // itself is already saying why the file cannot be read.
    adopt(ctx, res.ok ? readFileAnnotationSets(await jsonBody(res)) : []);
  } catch {
    // Offline or restarting: what is on screen stays until the next read.
  }
}

/** One write to a thread. The route's body on success; null with `actionError` set otherwise, or
 *  when another write is still in flight. */
async function act(ctx: Ctx, key: string, action: AnnotationAction): Promise<Record<string, unknown> | null> {
  const pathRel = ctx.deps.openPath.value;
  if (!pathRel || ctx.busyKey.value !== null) return null;
  ctx.busyKey.value = key;
  ctx.actionError.value = null;
  try {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) };
    const res = await fetchWithTimeout(url(ctx, pathRel), init, SLOW_COMMAND_TIMEOUT_MS);
    const body = await jsonBody(res);
    if (res.ok) return body;
    ctx.actionError.value = errorOf(body, res.status);
  } catch (e) {
    ctx.actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    ctx.busyKey.value = null;
  }
  return null;
}

async function reply(ctx: Ctx, key: string, body: string): Promise<boolean> {
  const thread = ctx.threads.value.find((entry) => entry.key === key);
  if (!thread || !body.trim()) return false;
  const pending = ctx.pendingReplies.get(key);
  const requestId = pending?.body === body ? pending.requestId : crypto.randomUUID();
  ctx.pendingReplies.set(key, { body, requestId });
  const answer = await act(ctx, key, { op: "reply", provider: thread.provider.id, threadId: thread.id, body, requestId });
  if (!answer) return false;
  ctx.pendingReplies.delete(key);
  const stored = readAnnotationReply(answer.reply);
  // The provider said what it stored: show that. It did not: read the thread again, which is
  // always right and one round trip slower.
  if (stored) ctx.threads.value = ctx.threads.value.map((entry) => (entry.key === key ? { ...entry, replies: [...entry.replies, stored] } : entry));
  else await refresh(ctx);
  return true;
}

async function resolve(ctx: Ctx, key: string): Promise<void> {
  const thread = ctx.threads.value.find((entry) => entry.key === key);
  if (!thread) return;
  const answer = await act(ctx, key, { op: "resolve", provider: thread.provider.id, threadId: thread.id });
  if (!answer) return;
  ctx.threads.value = ctx.threads.value.filter((entry) => entry.key !== key);
  pushMarks(ctx, true);
}

/** The file changed under the comments: forget everything about the last one. */
function reset(ctx: Ctx): void {
  ctx.read.id += 1;
  ctx.activeKey.value = null;
  ctx.actionError.value = null;
  ctx.pendingReplies.clear();
  adopt(ctx, []);
}

export function useFileAnnotations(deps: FileAnnotationsDeps): FileAnnotations {
  const sets = ref<FileAnnotationSet[]>([]);
  const covered = computed(() => {
    const pathRel = deps.openPath.value;
    return !!pathRel && !deps.unpreviewable.value && deps.providers.value.some((provider) => providerCoversFile(provider, pathRel));
  });
  const ctx: Ctx = {
    deps,
    sets,
    threads: ref([]),
    activeKey: ref(null),
    busyKey: ref(null),
    actionError: ref(null),
    covered,
    read: { id: 0 },
    pendingReplies: new Map(),
  };

  // A re-root makes a new editor, which knows nothing of the comments already read.
  watch(deps.editor, () => pushMarks(ctx, false));
  // `sync`, like the change marks: the new file's text goes into the editor in the same breath as
  // its path is set, and the last file's comments must be gone by then.
  watch(deps.openPath, () => reset(ctx), { flush: "sync" });
  watch([deps.openPath, deps.baseVersion, covered], () => void refresh(ctx));

  return {
    threads: ctx.threads,
    failures: computed(() => sets.value.flatMap((set) => (set.error ? [{ label: set.provider.label, error: set.error }] : []))),
    instructions: computed(() => sets.value.flatMap((set) => (set.instructions && set.threads.length > 0 ? [set.instructions] : [])).join("\n\n") || null),
    activeKey: ctx.activeKey,
    busyKey: ctx.busyKey,
    actionError: ctx.actionError,
    covered,
    refresh: () => refresh(ctx),
    reply: (key, body) => reply(ctx, key, body),
    resolve: (key) => resolve(ctx, key),
    // `editSeq` is read only to be depended on: the editor's answer is not reactive, and typing
    // above a thread moves its line.
    lineOf: (thread) => (deps.editSeq.value, deps.editor.value?.annotationLine(thread.key) ?? thread.line),
  };
}
