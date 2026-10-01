// Running an ANNOTATION PROVIDER: the user's declared command, one JSON request on stdin, one JSON
// answer on stdout (common/fileAnnotations.ts has the contract and why it is a command at all).
//
// ARGV, not a shell — the custom agent's rule and its tokenizer. The command comes from the global
// config and never from a request: the browser names a provider by id, and the id is looked up in
// the list the user wrote.
//
// Never rejects. A provider that is missing, slow, noisy or wrong is `ok: false` with one line of
// why, because the caller is a pane that should say "comments unavailable" beside a file that
// still opens.
import { spawn } from "node:child_process";
import { tokenizeCommandLine } from "../session/custom-agent-command.js";
import { isRecord } from "../../common/isRecord.js";
import { ANNOTATION_PROTOCOL_VERSION } from "../../common/fileAnnotations.js";

export type ProviderRequest = { op: "list" } | { op: "reply"; threadId: string; body: string; requestId: string } | { op: "resolve"; threadId: string };

/** The file a request is about, as every op is told it. */
export interface ProviderFile {
  /** Absolute path on this machine. */
  file: string;
  /** The Files pane's root, and the directory the command runs in. */
  root: string;
  /** `file` relative to `root`, with `/` separators. */
  path: string;
  /** The text on disk when the request was made — what a line number in the answer refers to. */
  content: string;
}

export type ProviderResult = { ok: true; answer: Record<string, unknown> } | { ok: false; error: string };

// A provider talks to something over the network. Long enough for one slow round trip, short enough
// that a hung one does not hold a process per file opened.
export const PROVIDER_TIMEOUT_MS = 20_000;
// An answer of the most threads this app shows, at the longest bodies it keeps, is well under this.
// Past it the child is stopped: the answer would be cut down anyway.
export const PROVIDER_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const ERROR_MAX = 200;

const firstLine = (text: string): string => (text.trim().split("\n")[0] ?? "").slice(0, ERROR_MAX);
const failed = (error: string): ProviderResult => ({ ok: false, error });

/** What the child's exit means. Exported for the spec: every branch is a way a provider goes wrong,
 *  and each needs to read as a sentence a person can act on. */
export function providerResultFrom(outcome: { code: number | null; stdout: string; stderr: string; overflow: boolean; spawnError: boolean }): ProviderResult {
  if (outcome.spawnError) return failed("the provider's command could not be started");
  if (outcome.overflow) return failed("the provider's answer was too large");
  if (outcome.code === null) return failed("the provider did not answer in time");
  if (outcome.code !== 0) return failed(firstLine(outcome.stderr) || `the provider exited with code ${outcome.code}`);
  let answer: unknown;
  try {
    answer = JSON.parse(outcome.stdout);
  } catch {
    return failed("the provider's answer was not JSON");
  }
  if (!isRecord(answer)) return failed("the provider's answer was not a JSON object");
  // A provider that ran fine and has a refusal to report — not logged in, comment already resolved —
  // says so here rather than by exit code, so its words reach the reader intact.
  if (typeof answer.error === "string" && answer.error.trim()) return failed(firstLine(answer.error));
  return { ok: true, answer };
}

export function runAnnotationProvider(
  command: string,
  target: ProviderFile,
  request: ProviderRequest,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResult> {
  const [bin, ...args] = tokenizeCommandLine(command);
  if (!bin) return Promise.resolve(failed("the provider has no command"));
  return new Promise((resolve) => {
    let child;
    try {
      // `timeout` kills the child and closes with a null code, which providerResultFrom reads as
      // "did not answer in time". `spawn` throws synchronously for an argument execve refuses.
      child = spawn(bin, args, { cwd: target.root, stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
    } catch {
      resolve(providerResultFrom({ code: null, stdout: "", stderr: "", overflow: false, spawnError: true }));
      return;
    }
    // Bytes, decoded once: a chunk boundary can fall inside a multibyte character, and a comment
    // in Japanese is the normal case here, not the edge.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let received = 0;
    let overflow = false;
    let spawnError = false;
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > PROVIDER_MAX_STDOUT_BYTES) {
        overflow = true;
        child.kill();
      } else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", () => {
      spawnError = true;
      resolve(providerResultFrom({ code: null, stdout: "", stderr: "", overflow, spawnError }));
    });
    child.on("close", (code) => {
      if (spawnError) return;
      resolve(providerResultFrom({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), overflow, spawnError }));
    });
    // A provider that exits without reading its input closes the pipe under the write.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ version: ANNOTATION_PROTOCOL_VERSION, ...request, ...target }));
  });
}
