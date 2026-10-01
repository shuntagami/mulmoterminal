# File annotation providers

Comments that live somewhere else — a review tool, a client-feedback database — shown beside the
lines of a file they are about, in the Files pane's editor. You can read a thread, reply to it,
resolve it, and hand it to the agent in the terminal beside the pane.

This app does not know where the comments come from. You **declare a provider**: a command this app
runs, which answers one JSON request on stdin with one JSON answer on stdout. Everything specific to
your source — its API, its login, how it decides which line a comment is on — lives in that command.

A complete provider in one file is in
[`samples/annotation-provider/sidecar-comments.mjs`](../samples/annotation-provider/sidecar-comments.mjs).
The types are in [`common/fileAnnotations.ts`](../common/fileAnnotations.ts), which is the contract;
this page is the prose version of it.

## Declaring one

In `~/.mulmoterminal/config.json`:

```json
{
  "annotationProviders": [
    { "id": "studio", "label": "Studio", "extensions": ["md"], "command": "node /Users/me/bin/studio-comments.mjs" }
  ]
}
```

| Field | |
|---|---|
| `id` | Lowercase slug (`a-z`, `0-9`, `-`, `_`; up to 32). Names the provider on the wire. |
| `label` | Shown beside each thread. Up to 24 characters; defaults to the id. |
| `command` | The command line. Up to 500 characters. |
| `extensions` | Which files to ask about, without the dot. **Name them**: left out, the command runs for every text file you open. |

Up to four providers. A change takes effect on the next file opened — no restart.

Three things about the declaration are deliberate:

- **Global config only.** A project's `.mulmoterminal.json` is a file a clone brings with it, and
  this command runs because a file was *opened*. A repository must not be able to hand you that.
- **The command is argv, not a shell.** It is split on spaces with quotes honoured, and nothing in
  it expands — no `~`, no `$HOME`, no pipes. Use absolute paths, or a wrapper script.
- **It runs in the Files pane's root** (the directory the pane is showing), with this server's
  environment. A token your provider needs comes from that environment or from a file it reads —
  never from the config, which the browser can read.

## The request

One JSON object on stdin, then stdin closes.

```json
{
  "version": 1,
  "op": "list",
  "file": "/Users/me/work/scripts/ep12.md",
  "root": "/Users/me/work",
  "path": "scripts/ep12.md",
  "content": "…the file's text as it is on disk…"
}
```

`file`, `root`, `path` and `content` are in every request. `content` is what a line number in your
answer refers to — the file as this server read it when the request was made, with its own line
endings. The other operations add:

| `op` | Adds | Meaning |
|---|---|---|
| `list` | — | The open threads on this file. |
| `reply` | `threadId`, `body`, `requestId` | Add a reply to a thread. |
| `resolve` | `threadId` | Mark a thread dealt with. |

`requestId` is the same across a retry of the same words. Store the reply under it (or pass it on as
your source's idempotency key) so a reply that did land the first time is not posted twice.

## The answer

One JSON object on stdout, exit 0. You have 20 seconds and 8 MB.

### `list`

```json
{
  "threads": [
    {
      "id": "8f3c…",
      "author": "Client",
      "body": "This paragraph is too long.",
      "createdAt": "2026-10-01T09:00:00Z",
      "line": 14,
      "endLine": 16,
      "placement": "moved",
      "quote": "the passage the comment was made on",
      "replies": [{ "id": "…", "author": "Me", "body": "On it.", "createdAt": "2026-10-01T09:30:00Z" }],
      "canReply": true,
      "canResolve": true
    }
  ],
  "instructions": "Commit and push before resolving a comment."
}
```

| Field | |
|---|---|
| `id` | **Required.** What a later `reply` or `resolve` names. A thread without one is dropped. |
| `line`, `endLine` | 1-based, in `content`. No `line` means the thread is shown as not placed. |
| `placement` | `exact` (default), `moved`, `estimated` or `unplaced`. Say how sure you are. |
| `quote` | The passage as the commenter saw it. Shown in the panel and given to the agent. |
| `canReply` | Default `true`. |
| `canResolve` | Default `false` — resolving changes someone else's record, so it is offered, not assumed. |
| `instructions` | Optional. What an agent must know before acting on these comments. |

**Placing a thread is your job, and the part worth getting right.** This app has a line and nothing
else; it carries that line through the reader's typing, but it cannot re-anchor. If your source
stores a comment as an offset into an older version, map it to the text in `content` — and when you
cannot find the passage, answer `unplaced` rather than a guess. A comment shown against the wrong
line is worse than one shown against none; an unplaced thread can still be read, answered and
resolved.

A file your source knows nothing about is `{ "threads": [] }`, not an error.

### `reply`

```json
{ "reply": { "id": "…", "author": "Me", "body": "Fixed in the new draft.", "createdAt": "2026-10-01T10:00:00Z" } }
```

`reply` is optional. With it, the panel shows exactly what you stored; without it (`{}`), the panel
reads the threads again.

### `resolve`

`{}`. The thread is removed from the panel.

### Refusing

A refusal the reader should see — not logged in, the comment was already resolved, push your changes
first — is an ordinary answer with exit 0:

```json
{ "error": "Push your changes before resolving a comment." }
```

Its first line is shown in the panel as written. A crash is a non-zero exit; the first line of
stderr is shown instead. Either way the file still opens — a provider failing never blocks the
editor, and one provider failing does not hide another's comments.

## What the reader sees

- A mark in the editor's gutter and a tint on the lines of each placed thread. They stay with their
  passage as the reader types above them.
- A panel beside the editor with each thread, its quote and replies, a reply box
  (<kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd> sends), and **Resolve** where you offered it.
- **Only beside the source.** The Markdown Preview is another document with no lines to hang a
  comment on; switch to Edit to see comments.
- **Ask the agent**, where there is a terminal beside the pane (the right pane next to an enlarged
  cell — not the full-screen `/files` view). It puts a request at the terminal's prompt, not sent:
  the file, your `instructions`, and each thread with its id. The agent edits the file; replying and
  resolving from the agent's side is up to whatever tools *it* has — typically an MCP server for the
  same source, registered in the project's `.mcp.json`.

Comments are read when a file is opened and again whenever it changes on disk. The panel's refresh
button reads them on demand.

## What this is not

- **Not a way to create comments.** There is no operation for a new thread.
- **Not a plugin API for panels.** A provider answers data; it does not draw anything.
- **Not available per project.** See "Global config only" above.
