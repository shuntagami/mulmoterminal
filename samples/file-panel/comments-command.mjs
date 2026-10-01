#!/usr/bin/env node
// The command half of the sample file panel (the page half is comments-panel.html beside it). The
// contract is docs/file-panels.md: one JSON request on stdin, one JSON answer on stdout, exit 0.
//
//   request  { version, file, root, path, content, payload }
//   answer   whatever JSON the page expects — the app passes it through unread
//
// `payload` is whatever the page sent. This sample's page sends { op: "list" | "reply" | "resolve" },
// which is this sample's own vocabulary: the app knows nothing about comments.
//
// It keeps a file's comments in a JSON file beside it: `notes.md` -> `notes.md.comments.json`,
//
//   { "threads": [ { "id": "t1", "author": "Client", "quote": "a passage from the file",
//                    "body": "Too long.", "createdAt": "2026-10-01T09:00:00Z", "replies": [] } ] }
//
// A real panel replaces `load` and `save` with calls to wherever its data lives — a review tool's
// API, a database — and keeps its token in its own file or in the environment, never in the page.
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

// Where a thread is in the text. When the passage cannot be found the thread has no line, and the
// page shows it without a mark — a comment against the wrong line is worse than one against none.
function place(thread, content) {
  if (typeof thread.quote !== "string" || !thread.quote) return {};
  const first = content.indexOf(thread.quote);
  if (first < 0) return {};
  return { line: lineAt(content, first), endLine: lineAt(content, first + thread.quote.length - 1) };
}

function list(request) {
  const open = load(request.file).threads.filter((thread) => !thread.resolved);
  return { threads: open.map((thread) => ({ ...thread, ...place(thread, request.content) })) };
}

function reply(request, { threadId, body, replyId }) {
  const store = load(request.file);
  const thread = store.threads.find((entry) => entry.id === threadId);
  if (!thread) return { error: "That comment is not there any more." };
  thread.replies = Array.isArray(thread.replies) ? thread.replies : [];
  // The page sends the same `replyId` when it retries: a reply that did land is found, not doubled.
  if (!thread.replies.some((entry) => entry.id === replyId)) {
    thread.replies.push({ id: replyId, author: process.env.USER ?? "me", body, createdAt: new Date().toISOString() });
    save(request.file, store);
  }
  return list(request);
}

function resolve(request, { threadId }) {
  const store = load(request.file);
  const thread = store.threads.find((entry) => entry.id === threadId);
  if (thread) {
    thread.resolved = true;
    save(request.file, store);
  }
  return list(request);
}

const OPS = { list, reply, resolve };

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const payload = request.payload ?? {};
  const op = OPS[payload.op];
  // A refusal the page should show is an ordinary answer. A crash — a non-zero exit — reaches the
  // page as a failed request carrying the first line of stderr.
  process.stdout.write(JSON.stringify(op ? op(request, payload) : { error: `unknown op: ${payload.op}` }));
});
