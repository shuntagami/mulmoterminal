// FILE PANELS: a way for something outside this app to sit beside a file in the Files pane.
//
// A panel is the user's own page, shown in a frame beside the editor, that can do five things and
// nothing else: learn which file is open, mark lines of it, move the editor to a line, ask its own
// command a question, and put text at the prompt of the terminal beside the pane. What the page
// MEANS by any of that — review comments, lint findings, translation notes — is not known here and
// must not become known here. That is the point of the port: the feature lives in the page.
//
// The whole contract is this file, in prose at docs/file-panels.md. Three decisions shape it:
//
//   - A panel is declared in the GLOBAL config only. A project's `.mulmoterminal.json` arrives with
//     a clone, and a page that loads — and a command that runs — because a file was OPENED must not
//     be something a repository can hand you.
//   - The page is sandboxed with no network of its own. It reaches the outside through its declared
//     `command`, which this server runs: one JSON request on stdin, one JSON answer on stdout, as
//     ARGV and never through a shell (server/session/custom-agent-command.ts says why).
//   - A mark is a line and an id. Deciding which line is the page's business; the editor only
//     carries the mark through the reader's typing.
import { isRecord } from "./isRecord.js";
import type { PreviewTheme } from "./previewTheme.js";

/** The contract's version, told to the page and to the command. One that does not know a later
 *  version can refuse it rather than misread it. */
export const FILE_PANEL_PROTOCOL_VERSION = 1;

export interface FilePanel {
  /** Stable slug. It names the panel on the wire and in its page's URL. */
  id: string;
  /** The frame's accessible name. */
  label: string;
  /** Absolute path of the HTML file shown in the frame. */
  page: string;
  /** The command line the page's requests are answered by, or null for a page that needs none. */
  command: string | null;
  /** Lower-cased extensions without the dot (`md`). Empty means every text file — and a frame
   *  loaded for every file opened, which is why the guide tells people to name them. */
  extensions: string[];
}

export const FILE_PANEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const FILE_PANEL_LABEL_MAX = 24;
export const FILE_PANEL_PATH_MAX = 500;
export const FILE_PANEL_COMMAND_MAX = 500;
export const FILE_PANELS_MAX = 4;
const EXTENSION_RE = /^[a-z0-9]{1,16}$/;
const EXTENSIONS_MAX = 16;
// POSIX or a Windows drive. Checked here, without `node:path`, because the browser reads this too.
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/;

const trimmed = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

const extensionsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const cleaned = value.flatMap((entry: unknown) => (typeof entry === "string" ? [entry.trim().toLowerCase().replace(/^\./, "")] : []));
  return [...new Set(cleaned.filter((ext) => EXTENSION_RE.test(ext)))].slice(0, EXTENSIONS_MAX);
};

function panelFrom(row: unknown): FilePanel | null {
  if (!isRecord(row)) return null;
  const id = trimmed(row.id, 64);
  const page = trimmed(row.page, FILE_PANEL_PATH_MAX);
  // A relative page is dropped rather than resolved: there is no directory it could honestly be
  // relative to, and guessing one is how a different file ends up in the frame.
  if (!FILE_PANEL_ID_RE.test(id) || !ABSOLUTE_PATH_RE.test(page)) return null;
  return {
    id,
    label: trimmed(row.label, FILE_PANEL_LABEL_MAX) || id,
    page,
    command: trimmed(row.command, FILE_PANEL_COMMAND_MAX) || null,
    extensions: extensionsOf(row.extensions),
  };
}

/** The config's `filePanels`, with anything unusable dropped. Used by both sides — the server
 *  reading config.json and the browser reading GET /api/config — so they cannot disagree about
 *  which panels exist. The first entry with an id keeps it. */
export function sanitizeFilePanels(input: unknown): FilePanel[] {
  if (!Array.isArray(input)) return [];
  const out: FilePanel[] = [];
  for (const row of input) {
    const panel = panelFrom(row);
    if (!panel || out.some((kept) => kept.id === panel.id)) continue;
    out.push(panel);
    if (out.length >= FILE_PANELS_MAX) break;
  }
  return out;
}

/** Whether `panel` wants to sit beside a file of this name. */
export function panelCoversFile(panel: FilePanel, filename: string): boolean {
  if (panel.extensions.length === 0) return true;
  const dot = filename.lastIndexOf(".");
  return dot >= 0 && panel.extensions.includes(filename.slice(dot + 1).toLowerCase());
}

// ---- the wire between the page and the pane -------------------------------------------------
//
// The page is opaque-origin (`sandbox allow-scripts`, never `allow-same-origin`), so `event.origin`
// on what it posts is the string "null" and identifies nothing. The pane checks `event.source`
// against its own frame instead; these tags are how a message that reached the wrong window is
// recognised, not a security boundary (common/mdPreviewMessage.ts, the same arrangement).

/** Tags a message the page sent to the pane. */
export const FILE_PANEL_FROM_PAGE = "mulmoterminal-file-panel";
/** Tags a message the pane sent to the page. */
export const FILE_PANEL_FROM_HOST = "mulmoterminal-file-panel-host";

/** A line the page wants marked. */
export interface PanelMark {
  /** The page's own name for it; what `mark-clicked` and `mark-lines` carry back. */
  id: string;
  /** 1-based first line. */
  line: number;
  /** 1-based last line, never before `line`. */
  endLine: number;
}

export const PANEL_MARKS_MAX = 500;
export const PANEL_MARK_ID_MAX = 200;
export const PANEL_INSERT_MAX = 20_000;
export const PANEL_REQUEST_ID_MAX = 100;

/** What the page says. */
export type FilePanelPageMessage =
  /** The page has loaded and wants to be told about the file. */
  | { kind: "ready" }
  /** Show or hide the panel. It starts hidden for every file: a panel with nothing to say about
   *  this one takes no room. */
  | { kind: "show"; visible: boolean }
  /** Replace this panel's marks. */
  | { kind: "marks"; marks: PanelMark[] }
  /** Put the editor's cursor on a line and bring it into view. */
  | { kind: "reveal"; line: number }
  /** Ask the panel's command. The answer comes back as `response` with the same id. */
  | { kind: "request"; requestId: string; payload: unknown }
  /** Put text at the prompt of the terminal beside the pane. It is not sent. */
  | { kind: "insert"; text: string };

const lineNumber = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null);

function markFrom(row: unknown): PanelMark | null {
  if (!isRecord(row) || typeof row.id !== "string" || !row.id || row.id.length > PANEL_MARK_ID_MAX) return null;
  const line = lineNumber(row.line);
  if (line === null) return null;
  return { id: row.id, line, endLine: Math.max(lineNumber(row.endLine) ?? line, line) };
}

/** The page's marks, read as untrusted: one without an id or a real line is dropped, and of two
 *  sharing an id the first is kept — the id is what a click reports. */
export function readPanelMarks(value: unknown): PanelMark[] {
  if (!Array.isArray(value)) return [];
  const out: PanelMark[] = [];
  for (const row of value.slice(0, PANEL_MARKS_MAX * 2)) {
    const mark = markFrom(row);
    if (!mark || out.some((kept) => kept.id === mark.id)) continue;
    out.push(mark);
    if (out.length >= PANEL_MARKS_MAX) break;
  }
  return out;
}

function pageBody(data: Record<string, unknown>): FilePanelPageMessage | null {
  const requestId = typeof data.requestId === "string" && data.requestId.length <= PANEL_REQUEST_ID_MAX ? data.requestId : "";
  const line = lineNumber(data.line);
  switch (data.kind) {
    case "ready":
      return { kind: "ready" };
    case "show":
      return { kind: "show", visible: data.visible === true };
    case "marks":
      return { kind: "marks", marks: readPanelMarks(data.marks) };
    case "reveal":
      return line === null ? null : { kind: "reveal", line };
    case "request":
      return requestId ? { kind: "request", requestId, payload: data.payload } : null;
    case "insert":
      return typeof data.text === "string" && data.text.trim() ? { kind: "insert", text: data.text.slice(0, PANEL_INSERT_MAX) } : null;
    default:
      return null;
  }
}

/** A message the page posted, or null for anything that is not one. */
export function readFilePanelPageMessage(data: unknown): FilePanelPageMessage | null {
  return isRecord(data) && data.source === FILE_PANEL_FROM_PAGE ? pageBody(data) : null;
}

/** The open file, as the page is told it. */
export interface PanelFile {
  /** Relative to `root`, with `/` separators. */
  path: string;
  /** The Files pane's root, absolute; null when it is the server's default workspace. */
  root: string | null;
  /** The text in the editor now — what a line number in `marks` refers to. */
  content: string;
  /** How the terminal beside the pane names this file (`@docs/a.md`), or null when there is no
   *  terminal to insert into — `insert` does nothing then. */
  reference: string | null;
}

/** What the pane says. */
export type FilePanelHostMessage =
  /** After `ready`, and again whenever another file is opened or this one changes on disk. Marks
   *  and visibility were reset before this arrives: say again what applies to THIS text. */
  | { kind: "file"; version: number; file: PanelFile; theme: PreviewTheme | null }
  /** A mark's own gutter icon was clicked. */
  | { kind: "mark-clicked"; id: string }
  /** Where each mark is now, after the reader's typing moved them. */
  | { kind: "mark-lines"; lines: Record<string, number> }
  /** The command's answer to `request`. `result` is whatever JSON it printed. */
  | { kind: "response"; requestId: string; ok: true; result: unknown }
  | { kind: "response"; requestId: string; ok: false; error: string };

/** What the pane asks the server, on the page's behalf. */
export function readPanelRequest(body: unknown): { panel: string; payload: unknown } | null {
  return isRecord(body) && typeof body.panel === "string" && body.panel ? { panel: body.panel, payload: body.payload } : null;
}
