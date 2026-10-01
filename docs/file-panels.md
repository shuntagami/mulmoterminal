# File panels

A **file panel** is your own page, shown beside a file in the Files pane's editor. It is how
something outside this app gets to sit next to the text: review comments, lint findings,
translation notes, a glossary check — the app does not know which, and does not need to.

A panel can do five things, and nothing else:

1. learn which file is open, and its text;
2. mark lines of it in the editor's gutter;
3. move the editor to a line;
4. ask **its own command** a question, which is how it reaches anything outside the browser;
5. put text at the prompt of the terminal beside the pane (it is not sent).

Everything that makes a panel a *comments* panel or a *lint* panel is in the page and its command.
A complete one — client review comments with replies, resolve, and a hand-off to the agent — is in
[`samples/file-panel/`](../samples/file-panel/): about 200 lines of page and 80 of command, with no
change to this app. The contract is [`common/filePanels.ts`](../common/filePanels.ts); this page is
the prose version of it.

## Declaring one

In `~/.mulmoterminal/config.json`:

```json
{
  "filePanels": [
    {
      "id": "comments",
      "label": "Comments",
      "extensions": ["md"],
      "page": "/Users/me/panels/comments-panel.html",
      "command": "node /Users/me/panels/comments-command.mjs"
    }
  ]
}
```

| Field | |
|---|---|
| `id` | Lowercase slug (`a-z`, `0-9`, `-`, `_`; up to 32). |
| `label` | The frame's accessible name. Up to 24 characters; defaults to the id. |
| `page` | **Absolute** path of one HTML file. Read from disk on every load, so editing it and reopening the file is the whole development loop. |
| `command` | Optional. The command line the page's requests are answered by. |
| `extensions` | Which files the panel sits beside, without the dot. **Name them**: left out, the page loads for every text file you open. |

Up to four panels. A change takes effect on the next file opened — no restart.

Three things about the declaration are deliberate:

- **Global config only.** A project's `.mulmoterminal.json` arrives with a clone, and a panel's
  page loads — and its command runs — because a file was *opened*. A repository must not be able
  to hand you that.
- **The command is argv, not a shell.** It is split on spaces with quotes honoured, and nothing in
  it expands — no `~`, no `$HOME`, no pipes. Use absolute paths, or a wrapper script.
- **Secrets stay out of the config and out of the page.** The browser can read the config, and the
  page is the browser. A token belongs in a file the command reads, or in the environment this
  server was started in.

## Where a panel appears

Beside the **source** of a file its `extensions` cover — in the right pane next to an enlarged
cell, and in the full-screen `/files` view. Not in the Markdown Preview: a panel's marks are on the
editor's lines, and the Preview is another document that has none.

The frame is loaded as soon as such a file opens, but **takes no room until the page asks**
(`show`). A panel with nothing to say about this file is loaded, listening and invisible.

## The page

One HTML file, with its script and style inline. It runs in a sandboxed frame with an opaque
origin and this policy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data:; font-src data:; form-action 'none'; base-uri 'none'; sandbox allow-scripts
```

So: no `fetch`, no scripts, styles, fonts or images from anywhere else, no cookies or storage, no
access to this app's `/api`. What the page knows it is told by message; what it reaches, it reaches
through its command.

The wire is `postMessage`. This is all of it:

```js
const send = (message) => parent.postMessage({ source: "mulmoterminal-file-panel", ...message }, "*");

window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.source !== "mulmoterminal-file-panel-host") return;
  // event.data.kind is one of: "file", "mark-lines", "mark-clicked", "response"
});

send({ kind: "ready" });
```

### What the page says

| `kind` | With | Meaning |
|---|---|---|
| `ready` | — | The page has loaded. Nothing is sent to it before this. |
| `show` | `visible` | Take room beside the editor, or give it back. Only `true` shows. |
| `marks` | `marks: [{ id, line, endLine? }]` | **Replace** this panel's marks. Lines are 1-based. Up to 500. |
| `reveal` | `line` | Put the editor's cursor on a line and bring it into view. |
| `request` | `requestId`, `payload` | Ask the panel's command. The answer arrives as `response`. |
| `insert` | `text` | Put text at the terminal's prompt. Not sent. Does nothing without a terminal. |

### What the page hears

| `kind` | With | Meaning |
|---|---|---|
| `file` | `version`, `file`, `theme` | The open file. Sent after `ready`, when another file is opened, and when this one changes on disk. |
| `mark-lines` | `lines: { id: line }` | Where each mark is now, after the reader's typing moved them. |
| `mark-clicked` | `id` | A mark's gutter icon was clicked. |
| `response` | `requestId`, `ok`, `result` \| `error` | The command's answer to a `request`. |

`file` is:

```json
{
  "path": "scripts/ep12.md",
  "root": "/Users/me/work",
  "content": "…the text in the editor now…",
  "reference": "@scripts/ep12.md"
}
```

- `content` is the editor's text, unsaved edits included. A line number in `marks` refers to it.
- `reference` is how the terminal beside the pane names this file, for building an `insert`. It is
  `null` when there is no terminal — the full-screen `/files` view has none.
- `theme` is the app's colours (`bg`, `fg`, `muted`, `subtle`, `border`, `link`, as hex), or `null`.

**When another file is opened, the app clears this panel's marks and hides it** before sending the
new `file`. Say again what applies to the new text. When the same file changes on disk, marks and
room are kept, and the page is expected to refresh them.

### Marks

A mark is an id and a line. The editor draws an icon in the gutter and tints the lines from `line`
to `endLine`, and from then on **carries the mark with its passage** as the reader types above it —
`mark-lines` reports where each one has got to.

Deciding which line is the page's business, and the part worth getting right. The app has a line
and nothing else; it cannot re-anchor. If your source stores a position as an offset into an older
version of the text, map it to the current `content` yourself — and when you cannot find the
passage, send no mark for it. Something shown against the wrong line is worse than something shown
in the panel with no line.

## The command

Run once per `request`, in the Files pane's root, with this server's environment. One JSON object
on stdin, then stdin closes:

```json
{
  "version": 1,
  "file": "/Users/me/work/scripts/ep12.md",
  "root": "/Users/me/work",
  "path": "scripts/ep12.md",
  "content": "…the file's text ON DISK…",
  "payload": { "op": "list" }
}
```

`payload` is whatever the page sent — its vocabulary is yours. `content` here is the file on disk,
not the editor's unsaved buffer.

Answer with **any JSON on stdout and exit 0**. It is passed to the page unread, as `result`. You
have 20 seconds and 8 MB.

A refusal the page should show — not logged in, already resolved — is an ordinary answer in your
own shape (`{ "error": "…" }`, say). Only a command that produced no answer at all is a failure to
the app: a non-zero exit, a timeout, output that is not JSON. The page then gets
`{ ok: false, error }`, where `error` is the first line of stderr or a sentence saying which.

To try a command without the app:

```sh
printf '%s' '{"version":1,"file":"/abs/a.md","root":"/abs","path":"a.md","content":"","payload":{"op":"list"}}' | node /abs/command.mjs
```

## What a panel cannot do

- **Change the file.** It can put a request in front of an agent, and the agent can.
- **Send to the terminal.** `insert` puts text at the prompt; a person presses Enter.
- **Draw in the editor**, beyond the gutter icon and the line tint.
- **Reach the network or this app's API** from the page. Only through its command.
- **Be declared by a project.** See "Global config only" above.
