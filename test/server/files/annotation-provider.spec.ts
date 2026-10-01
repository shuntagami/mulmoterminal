// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { providerResultFrom, runAnnotationProvider, type ProviderFile } from "../../../server/files/annotation-provider";

const outcome = (over: Partial<Parameters<typeof providerResultFrom>[0]> = {}) => ({
  code: 0,
  stdout: "{}",
  stderr: "",
  overflow: false,
  spawnError: false,
  ...over,
});

describe("providerResultFrom", () => {
  it("hands back the provider's JSON object", () => {
    expect(providerResultFrom(outcome({ stdout: '{"threads":[]}' }))).toEqual({ ok: true, answer: { threads: [] } });
  });

  // Each of these is a different thing for the user to fix, so each reads differently.
  it("says which way a provider went wrong", () => {
    expect(providerResultFrom(outcome({ spawnError: true, code: null }))).toEqual({ ok: false, error: "the provider's command could not be started" });
    expect(providerResultFrom(outcome({ overflow: true, code: null }))).toEqual({ ok: false, error: "the provider's answer was too large" });
    expect(providerResultFrom(outcome({ code: null }))).toEqual({ ok: false, error: "the provider did not answer in time" });
    expect(providerResultFrom(outcome({ stdout: "not json" }))).toEqual({ ok: false, error: "the provider's answer was not JSON" });
    expect(providerResultFrom(outcome({ stdout: "[]" }))).toEqual({ ok: false, error: "the provider's answer was not a JSON object" });
  });

  it("reports a failed exit in the provider's own words when it left any", () => {
    expect(providerResultFrom(outcome({ code: 2, stderr: "not logged in\n  at main (x.js:1)" }))).toEqual({ ok: false, error: "not logged in" });
    expect(providerResultFrom(outcome({ code: 2 }))).toEqual({ ok: false, error: "the provider exited with code 2" });
  });

  // A refusal the provider understood — the comment is already resolved — comes back as an
  // ordinary answer, so its wording survives.
  it("treats an `error` in a successful answer as the failure it reports", () => {
    expect(providerResultFrom(outcome({ stdout: '{"error":"このコメントは解決済みです"}' }))).toEqual({ ok: false, error: "このコメントは解決済みです" });
  });
});

describe("runAnnotationProvider", () => {
  const target = (root: string): ProviderFile => ({ file: path.join(root, "a.md"), root, path: "a.md", content: "one\ntwo\n" });
  /** A provider written to disk, run with the same node that runs the spec. */
  const providerAt = (dir: string, source: string): string => {
    const script = path.join(dir, "provider.mjs");
    writeFileSync(script, source);
    return `"${process.execPath}" "${script}"`;
  };
  const ECHO = `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ got: JSON.parse(input), cwd: process.cwd() })));`;

  it("sends one request on stdin, in the file's root, and reads the answer from stdout", async () => {
    const dir = makeTempDir("mt-annot-");
    const result = await runAnnotationProvider(providerAt(dir, ECHO), target(dir), { op: "reply", threadId: "t1", body: "直しました", requestId: "r-1" });
    expect(result).toEqual({
      ok: true,
      answer: {
        got: {
          version: 1,
          op: "reply",
          threadId: "t1",
          body: "直しました",
          requestId: "r-1",
          file: path.join(dir, "a.md"),
          root: dir,
          path: "a.md",
          content: "one\ntwo\n",
        },
        cwd: dir,
      },
    });
  });

  it("reports a provider that exits without answering", async () => {
    const dir = makeTempDir("mt-annot-");
    const result = await runAnnotationProvider(providerAt(dir, `process.stderr.write("no token\\n"); process.exit(3);`), target(dir), { op: "list" });
    expect(result).toEqual({ ok: false, error: "no token" });
  });

  it("stops a provider that does not answer in time", async () => {
    const dir = makeTempDir("mt-annot-");
    const result = await runAnnotationProvider(providerAt(dir, `setTimeout(() => {}, 60000);`), target(dir), { op: "list" }, 200);
    expect(result).toEqual({ ok: false, error: "the provider did not answer in time" });
  });

  it("reports a command that is not there, and one that is empty", async () => {
    const dir = makeTempDir("mt-annot-");
    expect(await runAnnotationProvider(path.join(dir, "no-such-program"), target(dir), { op: "list" })).toEqual({
      ok: false,
      error: "the provider's command could not be started",
    });
    expect(await runAnnotationProvider('""', target(dir), { op: "list" })).toEqual({ ok: false, error: "the provider has no command" });
  });
});
