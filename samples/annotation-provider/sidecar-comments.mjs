#!/usr/bin/env node
// A complete annotation provider in one file, for trying the feature and as a starting point for
// your own. The contract is docs/file-annotation-providers.md.
//
// It keeps a file's comments in a JSON file beside it: `notes.md` -> `notes.md.comments.json`,
//
//   { "threads": [ { "id": "t1", "author": "Client", "quote": "a passage from the file",
//                    "body": "Too long.", "createdAt": "2026-10-01T09:00:00Z", "replies": [] } ] }
//
// A real provider replaces the two functions that read and write that file with calls to wherever
// the comments live — a review tool's API, a database. Everything else stays the same shape:
// one JSON request on stdin, one JSON answer on stdout, exit 0.
//
// Declare it in ~/.mulmoterminal/config.json (an absolute path; nothing in the command expands):
//
//   { "annotationProviders": [
//       { "id": "sidecar", "label": "Notes", "extensions": ["md"],
//         "command": "node /abs/path/to/sidecar-comments.mjs" } ] }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import process from "node:process";

const sidecarOf = (file) => `${file}.comments.json`;

function load(file) {
  if (!existsSync(sidecarOf(file))) return { threads: [] };
  const stored = JSON.parse(readFileSync(sidecarOf(file), "utf8"));
  return { threads: Array.isArray(stored.threads) ? stored.threads : [] };
}

const save = (file, store) => writeFileSync(sidecarOf(file), `${JSON.stringify(store, null, 2)}\n`);

// 1-based line of an offset into `content`.
const lineAt = (content, offset) => content.slice(0, offset).split("\n").length;

// WHERE a thread is, in the text the app sent. This is the provider's job, and the part worth
// getting right: say how sure you are, and when you cannot find the passage, say `unplaced` rather
// than guess — a comment shown against the wrong line is worse than one shown against none.
function place(thread, content) {
  if (typeof thread.quote === "string" && thread.quote) {
    const first = content.indexOf(thread.quote);
    if (first < 0) return { placement: "unplaced" };
    // The same words twice: this provider cannot tell which was meant, so it says it is guessing.
    const again = content.indexOf(thread.quote, first + 1) >= 0;
    return { line: lineAt(content, first), endLine: lineAt(content, first + thread.quote.length - 1), placement: again ? "estimated" : "exact" };
  }
  return Number.isInteger(thread.line) ? { line: thread.line, placement: "exact" } : { placement: "unplaced" };
}

function list(request) {
  const open = load(request.file).threads.filter((thread) => !thread.resolved);
  return {
    threads: open.map((thread) => ({ ...thread, ...place(thread, request.content), canReply: true, canResolve: true })),
    // Optional. Put at the head of the request the panel's "Ask the agent" builds.
    instructions: `When a comment is dealt with, mark it "resolved": true in ${request.path}.comments.json.`,
  };
}

function reply(request) {
  const store = load(request.file);
  const thread = store.threads.find((entry) => entry.id === request.threadId);
  if (!thread) return { error: "that comment is not there any more" };
  thread.replies = Array.isArray(thread.replies) ? thread.replies : [];
  // `requestId` is the same across a retry of the same words: store under it, and a reply that
  // did land the first time is found here instead of being posted twice.
  const stored = thread.replies.find((entry) => entry.id === request.requestId);
  if (stored) return { reply: stored };
  const added = { id: request.requestId, author: process.env.USER ?? "me", body: request.body, createdAt: new Date().toISOString() };
  thread.replies.push(added);
  save(request.file, store);
  return { reply: added };
}

function resolve(request) {
  const store = load(request.file);
  const thread = store.threads.find((entry) => entry.id === request.threadId);
  if (!thread) return { error: "that comment is not there any more" };
  thread.resolved = true;
  save(request.file, store);
  return {};
}

const OPS = { list, reply, resolve };

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const op = OPS[request.op];
  // A refusal the reader should see goes in `error`, with exit 0. A crash goes to stderr with a
  // non-zero exit, and the app shows its first line.
  const answer = request.version !== 1 || !op ? { error: `this provider does not know ${request.op} (version ${request.version})` } : op(request);
  process.stdout.write(JSON.stringify(answer));
});
