// Running a FILE PANEL's command: the user's declared command line, one JSON request on stdin, one
// JSON answer on stdout (common/filePanels.ts has the contract and why it is a command at all).
//
// ARGV, not a shell — the custom agent's rule and its tokenizer. The command comes from the global
// config and never from a request: the browser names a panel by id, and the id is looked up in the
// list the user wrote.
//
// Never rejects. A command that is missing, slow, noisy or wrong is `ok: false` with one line of
// why, because the caller is a page that should be able to say so in its own words.
import { spawn } from "node:child_process";
import { tokenizeCommandLine } from "../session/custom-agent-command.js";
import { FILE_PANEL_PROTOCOL_VERSION } from "../../common/filePanels.js";

/** The file a request is about, as the command is told it. */
export interface PanelCommandFile {
  /** Absolute path on this machine. */
  file: string;
  /** The Files pane's root, and the directory the command runs in. */
  root: string;
  /** `file` relative to `root`, with `/` separators. */
  path: string;
  /** The text on DISK when the request was made — not the editor's unsaved buffer. */
  content: string;
}

export type PanelCommandResult = { ok: true; result: unknown } | { ok: false; error: string };

// A panel's command talks to something over the network. Long enough for one slow round trip,
// short enough that a hung one does not hold a process per request.
export const PANEL_COMMAND_TIMEOUT_MS = 20_000;
// Past this the child is stopped: a page has no use for an answer this large.
export const PANEL_COMMAND_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const ERROR_MAX = 200;

const firstLine = (text: string): string => (text.trim().split("\n")[0] ?? "").slice(0, ERROR_MAX);
const failed = (error: string): PanelCommandResult => ({ ok: false, error });

/** What the child's exit means. Exported for the spec: every branch is a way a command goes wrong,
 *  and each needs to read as a sentence a person can act on.
 *
 *  A zero exit with JSON on stdout is the answer, whatever that JSON is — a refusal the page
 *  understands (not logged in, already done) belongs IN it, in the page's own vocabulary. Only a
 *  command that did not produce an answer at all is a failure here. */
export function panelCommandResultFrom(outcome: {
  code: number | null;
  stdout: string;
  stderr: string;
  overflow: boolean;
  spawnError: boolean;
}): PanelCommandResult {
  if (outcome.spawnError) return failed("the panel's command could not be started");
  if (outcome.overflow) return failed("the panel's command answered with too much");
  if (outcome.code === null) return failed("the panel's command did not answer in time");
  if (outcome.code !== 0) return failed(firstLine(outcome.stderr) || `the panel's command exited with code ${outcome.code}`);
  try {
    const result: unknown = JSON.parse(outcome.stdout);
    return { ok: true, result };
  } catch {
    return failed("the panel's command did not answer with JSON");
  }
}

export function runPanelCommand(
  command: string,
  target: PanelCommandFile,
  payload: unknown,
  timeoutMs = PANEL_COMMAND_TIMEOUT_MS,
): Promise<PanelCommandResult> {
  const [bin, ...args] = tokenizeCommandLine(command);
  if (!bin) return Promise.resolve(failed("the panel has no command"));
  return new Promise((resolve) => {
    let child;
    try {
      // `timeout` kills the child and closes with a null code, which panelCommandResultFrom reads as
      // "did not answer in time". `spawn` throws synchronously for an argument execve refuses.
      child = spawn(bin, args, { cwd: target.root, stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
    } catch {
      resolve(panelCommandResultFrom({ code: null, stdout: "", stderr: "", overflow: false, spawnError: true }));
      return;
    }
    // Bytes, decoded once: a chunk boundary can fall inside a multibyte character.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let received = 0;
    let overflow = false;
    let spawnError = false;
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > PANEL_COMMAND_MAX_STDOUT_BYTES) {
        overflow = true;
        child.kill();
      } else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", () => {
      spawnError = true;
      resolve(panelCommandResultFrom({ code: null, stdout: "", stderr: "", overflow, spawnError }));
    });
    child.on("close", (code) => {
      if (spawnError) return;
      resolve(panelCommandResultFrom({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), overflow, spawnError }));
    });
    // A command that exits without reading its input closes the pipe under the write.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ version: FILE_PANEL_PROTOCOL_VERSION, ...target, payload: payload ?? null }));
  });
}
