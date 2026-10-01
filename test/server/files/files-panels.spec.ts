// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";
import { mountFilePanelRoutes, PANEL_PAGE_MAX_BYTES, type FilePanelRouteDeps } from "../../../server/files/files-panels";
import type { FilePanel } from "../../../common/filePanels";
import type { PanelCommandResult } from "../../../server/files/file-panel-command";

/** The routes over one directory holding `a.md`, with one declared panel whose page is on disk. */
function serve(run: NonNullable<FilePanelRouteDeps["run"]>, over: Partial<FilePanel> = {}) {
  const dir = makeTempDir("mt-panel-route-");
  writeFileSync(path.join(dir, "a.md"), "one\ntwo\n");
  const page = path.join(dir, "panel.html");
  writeFileSync(page, "<!doctype html><title>Studio</title><p>panel</p>");
  const panel: FilePanel = { id: "studio", label: "Studio", page, command: "studio-command", extensions: ["md"], ...over };
  const app = express();
  app.use(express.json());
  const readText: FilePanelRouteDeps["readText"] = (res, abs) => {
    if (abs.endsWith("missing.md")) {
      res.status(404).json({ error: "not found" });
      return null;
    }
    return "one\ntwo\n";
  };
  mountFilePanelRoutes(app, { base: () => dir, readText, panels: () => [panel], run });
  return { call: routeCall(app), dir };
}

const answers = (result: unknown) => vi.fn(async (): Promise<PanelCommandResult> => ({ ok: true, result }));

describe("GET /api/files/panel/:id/page", () => {
  // The page is somebody's own code. It gets no network of its own, and the frame's sandbox is
  // repeated as a header so opening the URL directly is no different.
  it("serves the declared page under a policy with no network and a sandbox", async () => {
    const { call } = serve(answers({}));
    const res = await call("/api/files/panel/studio/page");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<p>panel</p>");
    expect(res.headers["content-type"]).toContain("text/html");
    const csp = res.headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("connect-src");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // The id is looked up in the user's list. A request cannot name a path.
  it("serves nothing for a panel that is not declared", async () => {
    const { call } = serve(answers({}));
    expect((await call("/api/files/panel/elsewhere/page")).status).toBe(404);
    expect((await call(`/api/files/panel/${encodeURIComponent("../../etc/passwd")}/page`)).status).toBe(404);
  });

  it("serves nothing when the declared page is missing, a directory, or too large to be a page", async () => {
    const dir = makeTempDir("mt-panel-page-");
    const huge = path.join(dir, "huge.html");
    writeFileSync(huge, Buffer.alloc(PANEL_PAGE_MAX_BYTES + 1, 32));
    for (const page of [path.join(dir, "nope.html"), dir, huge]) {
      const { call } = serve(answers({}), { page });
      expect((await call("/api/files/panel/studio/page")).status).toBe(404);
    }
  });
});

describe("POST /api/files/browse/panel", () => {
  it("hands the page's payload to its panel's command with the file, and answers what it printed", async () => {
    const run = answers({ threads: [{ id: "t1" }] });
    const { call, dir } = serve(run);
    const res = await call("/api/files/browse/panel?path=a.md", jsonPost({ panel: "studio", payload: { op: "list" } }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, result: { threads: [{ id: "t1" }] } });
    expect(run).toHaveBeenCalledWith("studio-command", { file: path.join(dir, "a.md"), root: dir, path: "a.md", content: "one\ntwo\n" }, { op: "list" });
  });

  // 502: this server is fine, the thing behind it is not — and its words are what the page shows.
  it("answers a command that gave no answer as the failure, in its words", async () => {
    const { call } = serve(vi.fn(async (): Promise<PanelCommandResult> => ({ ok: false, error: "no token" })));
    const res = await call("/api/files/browse/panel?path=a.md", jsonPost({ panel: "studio", payload: {} }));
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "no token" });
  });

  // The browser names a panel by id; a command never comes from a request.
  it("refuses a panel that is not declared, one with no command, and a body that names none", async () => {
    const run = answers({});
    const { call } = serve(run);
    expect((await call("/api/files/browse/panel?path=a.md", jsonPost({ panel: "elsewhere", command: "rm -rf /" }))).status).toBe(404);
    expect((await call("/api/files/browse/panel?path=a.md", jsonPost({ payload: {} }))).status).toBe(400);
    const silent = serve(run, { command: null });
    expect((await silent.call("/api/files/browse/panel?path=a.md", jsonPost({ panel: "studio" }))).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a path outside the root, and answers as the file read does when the file cannot be read", async () => {
    const run = answers({});
    const { call } = serve(run);
    expect((await call("/api/files/browse/panel?path=../outside.md", jsonPost({ panel: "studio" }))).status).toBe(403);
    expect((await call("/api/files/browse/panel?path=missing.md", jsonPost({ panel: "studio" }))).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});

// Through the real browse mount and a real process: the wiring, once.
describe("the panel routes as the Files pane reaches them", () => {
  it("runs a declared panel's command against the file on disk", async () => {
    const dir = makeTempDir("mt-panel-real-");
    writeFileSync(path.join(dir, "a.md"), "one\ntwo\n");
    const script = path.join(dir, "command.mjs");
    writeFileSync(
      script,
      `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({ line: request.content.split("\\n")[request.payload.index], path: request.path }));
});`,
    );
    const panel: FilePanel = {
      id: "real",
      label: "Real",
      page: path.join(dir, "panel.html"),
      command: `"${process.execPath}" "${script}"`,
      extensions: ["md"],
    };
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups"), filePanels: () => [panel] });
    const res = await routeCall(app)("/api/files/browse/panel?path=a.md", jsonPost({ panel: "real", payload: { index: 1 } }));
    expect(res.body).toEqual({ ok: true, result: { line: "two", path: "a.md" } });
  });

  it("has no panel to serve where none is declared", async () => {
    const dir = makeTempDir("mt-panel-real-");
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
    expect((await routeCall(app)("/api/files/panel/any/page")).status).toBe(404);
  });
});
