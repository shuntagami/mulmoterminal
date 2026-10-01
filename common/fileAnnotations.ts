// FILE ANNOTATIONS: comments that live somewhere else — a review tool, a client-feedback database —
// shown beside the lines of a file they are about, in the Files pane's editor.
//
// This app knows nothing about where they come from. A user DECLARES a provider in the global
// config (`annotationProviders`), and a provider is a command line this app runs: one JSON request
// on stdin, one JSON answer on stdout. The whole contract is the types in this file, and
// docs/file-annotation-providers.md is the prose version of it.
//
// Three things the shape decides, each on purpose:
//
//   - The provider places a thread on a LINE (1-based). How it got there — an offset into an older
//     version, a quoted passage it searched for — is its own business, and it says how sure it is
//     in `placement`. The editor then carries the line through the reader's typing; it never
//     re-anchors, because it has nothing to re-anchor with.
//   - A provider is declared in the GLOBAL config only. A project's own `.mulmoterminal.json` is a
//     file a clone brings with it, and a command that runs because a file was OPENED must not be
//     something a repository can hand you.
//   - The command runs as ARGV, not through a shell, for the reason a custom agent's does
//     (server/session/custom-agent-command.ts): nothing in it expands.
import { isRecord } from "./isRecord.js";

/** The contract's version, sent in every request. A provider that does not know a later one can
 *  refuse it rather than misread it. */
export const ANNOTATION_PROTOCOL_VERSION = 1;

export interface AnnotationProvider {
  /** Stable slug. It keys the wire: a reply names the provider that owns the thread. */
  id: string;
  /** What the panel shows beside a thread, so two providers' comments can be told apart. */
  label: string;
  /** The command line to run. One JSON request on stdin, one JSON answer on stdout. */
  command: string;
  /** Lower-cased extensions without the dot (`md`). Empty means every text file — and a process
   *  started for every file opened, which is why the guide tells people to name them. */
  extensions: string[];
}

export const ANNOTATION_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const ANNOTATION_PROVIDER_LABEL_MAX = 24;
export const ANNOTATION_PROVIDER_COMMAND_MAX = 500;
export const ANNOTATION_PROVIDERS_MAX = 4;
const EXTENSION_RE = /^[a-z0-9]{1,16}$/;
const EXTENSIONS_MAX = 16;

const extensionsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const cleaned = value.flatMap((entry: unknown) => (typeof entry === "string" ? [entry.trim().toLowerCase().replace(/^\./, "")] : []));
  return [...new Set(cleaned.filter((ext) => EXTENSION_RE.test(ext)))].slice(0, EXTENSIONS_MAX);
};

function providerFrom(row: unknown): AnnotationProvider | null {
  if (!isRecord(row) || typeof row.id !== "string" || typeof row.command !== "string") return null;
  const id = row.id.trim();
  const command = row.command.trim().slice(0, ANNOTATION_PROVIDER_COMMAND_MAX);
  if (!ANNOTATION_PROVIDER_ID_RE.test(id) || !command) return null;
  const label = (typeof row.label === "string" ? row.label.trim() : "").slice(0, ANNOTATION_PROVIDER_LABEL_MAX) || id;
  return { id, label, command, extensions: extensionsOf(row.extensions) };
}

/** The config's `annotationProviders`, with anything unusable dropped. Used by both sides — the
 *  server reading config.json and the browser reading GET /api/config — so they cannot disagree
 *  about which entries exist. The first entry with an id keeps it. */
export function sanitizeAnnotationProviders(input: unknown): AnnotationProvider[] {
  if (!Array.isArray(input)) return [];
  const out: AnnotationProvider[] = [];
  for (const row of input) {
    const provider = providerFrom(row);
    if (!provider || out.some((kept) => kept.id === provider.id)) continue;
    out.push(provider);
    if (out.length >= ANNOTATION_PROVIDERS_MAX) break;
  }
  return out;
}

/** Whether `provider` wants to be asked about a file of this name. */
export function providerCoversFile(provider: AnnotationProvider, filename: string): boolean {
  if (provider.extensions.length === 0) return true;
  const dot = filename.lastIndexOf(".");
  return dot >= 0 && provider.extensions.includes(filename.slice(dot + 1).toLowerCase());
}

// How the provider arrived at the line. `exact` is the default and draws no label; the others are
// said out loud, because a comment shown against the wrong passage is worse than one shown against
// none.
export const ANNOTATION_PLACEMENTS = ["exact", "moved", "estimated", "unplaced"] as const;
export type AnnotationPlacement = (typeof ANNOTATION_PLACEMENTS)[number];
const isPlacement = (value: unknown): value is AnnotationPlacement => ANNOTATION_PLACEMENTS.some((placement) => placement === value);

export interface AnnotationComment {
  id: string;
  author: string;
  body: string;
  /** An ISO time, or null when the provider has none. Shown in the reader's locale. */
  createdAt: string | null;
}

export interface AnnotationThread extends AnnotationComment {
  /** 1-based first line, or null for a thread the provider could not place. */
  line: number | null;
  /** 1-based last line, never before `line`; equal to it for a single line. */
  endLine: number | null;
  placement: AnnotationPlacement;
  /** The passage the comment was made on, as the commenter saw it. */
  quote: string | null;
  replies: AnnotationComment[];
  canReply: boolean;
  canResolve: boolean;
}

/** One provider's answer for one file, as the route hands it to the browser. */
export interface FileAnnotationSet {
  provider: { id: string; label: string };
  threads: AnnotationThread[];
  /** What the provider wants an agent told before it acts on these — a sync step, a tool to call
   *  when done. Put at the head of the prompt the panel builds; null for none. */
  instructions: string | null;
  /** Why this provider has nothing to show, when it failed rather than found nothing. */
  error: string | null;
}

export const ANNOTATION_THREADS_MAX = 200;
export const ANNOTATION_REPLIES_MAX = 100;
export const ANNOTATION_BODY_MAX = 20_000;
export const ANNOTATION_INSTRUCTIONS_MAX = 8_000;
const SHORT_TEXT_MAX = 200;
const QUOTE_MAX = 2_000;

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const lineNumber = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null);

function commentFrom(row: unknown): AnnotationComment | null {
  if (!isRecord(row)) return null;
  const id = text(row.id, SHORT_TEXT_MAX);
  if (!id) return null;
  return { id, author: text(row.author, SHORT_TEXT_MAX), body: text(row.body, ANNOTATION_BODY_MAX), createdAt: text(row.createdAt, SHORT_TEXT_MAX) || null };
}

function threadFrom(row: unknown): AnnotationThread | null {
  const root = commentFrom(row);
  if (!root || !isRecord(row)) return null;
  const line = row.placement === "unplaced" ? null : lineNumber(row.line);
  const endLine = line === null ? null : Math.max(lineNumber(row.endLine) ?? line, line);
  const replies = Array.isArray(row.replies) ? row.replies.flatMap((reply: unknown) => commentFrom(reply) ?? []) : [];
  // A thread with no line is unplaced whatever it claims, and one with a line cannot be.
  const claimed = isPlacement(row.placement) && row.placement !== "unplaced" ? row.placement : "exact";
  return {
    ...root,
    line,
    endLine,
    placement: line === null ? "unplaced" : claimed,
    quote: text(row.quote, QUOTE_MAX) || null,
    replies: replies.slice(0, ANNOTATION_REPLIES_MAX),
    // Replying is the point, so it is on unless refused; resolving changes someone else's record,
    // so it is off unless offered.
    canReply: row.canReply !== false,
    canResolve: row.canResolve === true,
  };
}

/** The `threads` of a provider's answer (or of the route's), read as untrusted: an entry without
 *  an id is dropped, a line that is not a positive integer makes the thread unplaced, and long
 *  text is cut. Threads sharing an id keep the first — the id is what a reply names. */
export function readAnnotationThreads(value: unknown): AnnotationThread[] {
  if (!Array.isArray(value)) return [];
  const out: AnnotationThread[] = [];
  for (const row of value) {
    const thread = threadFrom(row);
    if (!thread || out.some((kept) => kept.id === thread.id)) continue;
    out.push(thread);
    if (out.length >= ANNOTATION_THREADS_MAX) break;
  }
  return out;
}

/** A reply as the provider reports having stored it, or null when it reported nothing usable. */
export const readAnnotationReply = (value: unknown): AnnotationComment | null => commentFrom(value);

/** The route's answer to a list, read back in the browser. */
export function readFileAnnotationSets(body: unknown): FileAnnotationSet[] {
  if (!isRecord(body) || !Array.isArray(body.sets)) return [];
  return body.sets.flatMap((row: unknown): FileAnnotationSet[] => {
    if (!isRecord(row) || !isRecord(row.provider) || typeof row.provider.id !== "string") return [];
    const provider = { id: row.provider.id, label: text(row.provider.label, ANNOTATION_PROVIDER_LABEL_MAX) || row.provider.id };
    return [
      {
        provider,
        threads: readAnnotationThreads(row.threads),
        instructions: text(row.instructions, ANNOTATION_INSTRUCTIONS_MAX) || null,
        error: text(row.error, SHORT_TEXT_MAX) || null,
      },
    ];
  });
}

/** What the browser asks the route to do to a thread. */
export type AnnotationAction =
  { op: "reply"; provider: string; threadId: string; body: string; requestId: string } | { op: "resolve"; provider: string; threadId: string };

export function readAnnotationAction(body: unknown): AnnotationAction | null {
  if (!isRecord(body) || typeof body.provider !== "string" || typeof body.threadId !== "string" || !body.threadId) return null;
  const { provider, threadId } = body;
  if (body.op === "resolve") return { op: "resolve", provider, threadId };
  if (body.op !== "reply" || typeof body.body !== "string" || typeof body.requestId !== "string") return null;
  const replyBody = body.body.slice(0, ANNOTATION_BODY_MAX);
  return replyBody.trim() && body.requestId ? { op: "reply", provider, threadId, body: replyBody, requestId: body.requestId.slice(0, SHORT_TEXT_MAX) } : null;
}
