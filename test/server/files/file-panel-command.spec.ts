// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { panelCommandResultFrom, runPanelCommand, type PanelCommandFile } from "../../../server/files/file-panel-command";

const outcome = (over: Partial<Parameters<typeof panelCommandResultFrom>[0]> = {}) => ({
  code: 0,
  stdout: "{}",
  stderr: "",
  overflow: false,
  spawnError: false,
  ...over,
});

describe("panelCommandResultFrom", () => {
  // Whatever JSON the command printed is the answer. What it means is the page's business, so a
  // refusal the page understands travels as an ordinary answer.
  it("hands back the command's JSON, whatever it is", () => {
    expect(panelCommandResultFrom(outcome({ stdout: '{"threads":[]}' }))).toEqual({ ok: true, result: { threads: [] } });
    expect(panelCommandResultFrom(outcome({ stdout: "[1,2]" }))).toEqual({ ok: true, result: [1, 2] });
    expect(panelCommandResultFrom(outcome({ stdout: '{"error":"not logged in"}' }))).toEqual({ ok: true, result: { error: "not logged in" } });
  });

  // Each of these is a different thing for the user to fix, so each reads differently.
  it("says which way a command went wrong", () => {
    expect(panelCommandResultFrom(outcome({ spawnError: true, code: null }))).toEqual({ ok: false, error: "the panel's command could not be started" });
    expect(panelCommandResultFrom(outcome({ overflow: true, code: null }))).toEqual({ ok: false, error: "the panel's command answered with too much" });
    expect(panelCommandResultFrom(outcome({ code: null }))).toEqual({ ok: false, error: "the panel's command did not answer in time" });
    expect(panelCommandResultFrom(outcome({ stdout: "not json" }))).toEqual({ ok: false, error: "the panel's command did not answer with JSON" });
  });

  it("reports a failed exit in the command's own words when it left any", () => {
    expect(panelCommandResultFrom(outcome({ code: 2, stderr: "no token\n  at main (x.js:1)" }))).toEqual({ ok: false, error: "no token" });
    expect(panelCommandResultFrom(outcome({ code: 2 }))).toEqual({ ok: false, error: "the panel's command exited with code 2" });
  });
});

describe("runPanelCommand", () => {
  const target = (root: string): PanelCommandFile => ({ file: path.join(root, "a.md"), root, path: "a.md", content: "one\ntwo\n" });
  /** A command written to disk, run with the same node that runs the spec. */
  const commandAt = (dir: string, source: string): string => {
    const script = path.join(dir, "command.mjs");
    writeFileSync(script, source);
    return `"${process.execPath}" "${script}"`;
  };
  const ECHO = `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ got: JSON.parse(input), cwd: process.cwd() })));`;

  it("sends one request on stdin, in the file's root, and reads the answer from stdout", async () => {
    const dir = makeTempDir("mt-panel-");
    const result = await runPanelCommand(commandAt(dir, ECHO), target(dir), { op: "reply", body: "直しました" });
    expect(result).toEqual({
      ok: true,
      result: {
        got: { version: 1, file: path.join(dir, "a.md"), root: dir, path: "a.md", content: "one\ntwo\n", payload: { op: "reply", body: "直しました" } },
        cwd: dir,
      },
    });
  });

  // A page that sent nothing still gets a well-formed request.
  it("sends a null payload for a request that carried none", async () => {
    const dir = makeTempDir("mt-panel-");
    const result = await runPanelCommand(commandAt(dir, ECHO), target(dir), undefined);
    expect(result).toMatchObject({ ok: true, result: { got: { payload: null } } });
  });

  it("reports a command that exits without answering", async () => {
    const dir = makeTempDir("mt-panel-");
    const result = await runPanelCommand(commandAt(dir, `process.stderr.write("no token\\n"); process.exit(3);`), target(dir), {});
    expect(result).toEqual({ ok: false, error: "no token" });
  });

  it("stops a command that does not answer in time", async () => {
    const dir = makeTempDir("mt-panel-");
    const result = await runPanelCommand(commandAt(dir, `setTimeout(() => {}, 60000);`), target(dir), {}, 200);
    expect(result).toEqual({ ok: false, error: "the panel's command did not answer in time" });
  });

  it("reports a command that is not there, and one that is empty", async () => {
    const dir = makeTempDir("mt-panel-");
    expect(await runPanelCommand(path.join(dir, "no-such-program"), target(dir), {})).toEqual({ ok: false, error: "the panel's command could not be started" });
    expect(await runPanelCommand('""', target(dir), {})).toEqual({ ok: false, error: "the panel has no command" });
  });
});
