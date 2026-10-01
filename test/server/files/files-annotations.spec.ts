// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { makeTempDir } from "../../support/tempDir.js";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";
import { mountFilesAnnotationsRoute, type FilesAnnotationsDeps } from "../../../server/files/files-annotations";
import type { AnnotationProvider } from "../../../common/fileAnnotations";
import type { ProviderResult } from "../../../server/files/annotation-provider";

const STUDIO: AnnotationProvider = { id: "studio", label: "Studio", command: "studio-comments", extensions: ["md"] };
const NOTES: AnnotationProvider = { id: "notes", label: "Notes", command: "notes-comments", extensions: [] };

/** The route over one directory holding `a.md`, with the providers answered by `run`. */
function serve(providers: AnnotationProvider[], run: NonNullable<FilesAnnotationsDeps["run"]>) {
  const dir = makeTempDir("mt-annot-route-");
  writeFileSync(path.join(dir, "a.md"), "one\ntwo\n");
  writeFileSync(path.join(dir, "a.ts"), "export {};\n");
  const app = express();
  app.use(express.json());
  const readText: FilesAnnotationsDeps["readText"] = (res, abs) => {
    if (abs.endsWith("missing.md")) {
      res.status(404).json({ error: "not found" });
      return null;
    }
    return "one\ntwo\n";
  };
  mountFilesAnnotationsRoute(app, { base: () => dir, readText, providers: () => providers, run });
  return { call: routeCall(app), dir };
}

const answers = (answer: Record<string, unknown>) => vi.fn(async (): Promise<ProviderResult> => ({ ok: true, answer }));

describe("GET /api/files/browse/annotations", () => {
  it("answers each covering provider's threads, read as untrusted", async () => {
    const run = answers({ threads: [{ id: "t1", author: "Client", body: "Too long.", line: 2 }, { body: "no id" }], instructions: "Sync first." });
    const { call, dir } = serve([STUDIO], run);
    const res = await call("/api/files/browse/annotations?path=a.md");
    expect(res.status).toBe(200);
    expect(res.body.sets).toEqual([
      {
        provider: { id: "studio", label: "Studio" },
        threads: [
          {
            id: "t1",
            author: "Client",
            body: "Too long.",
            createdAt: null,
            line: 2,
            endLine: 2,
            placement: "exact",
            quote: null,
            replies: [],
            canReply: true,
            canResolve: false,
          },
        ],
        instructions: "Sync first.",
        error: null,
      },
    ]);
    expect(run).toHaveBeenCalledWith("studio-comments", { file: path.join(dir, "a.md"), root: dir, path: "a.md", content: "one\ntwo\n" }, { op: "list" });
  });

  // The common case: nothing declared for this kind of file. No process, no read.
  it("runs nothing for a file no provider covers", async () => {
    const run = answers({ threads: [] });
    const { call } = serve([STUDIO], run);
    expect((await call("/api/files/browse/annotations?path=a.ts")).body).toEqual({ sets: [] });
    expect(run).not.toHaveBeenCalled();
  });

  // One source being down must not hide the other's comments.
  it("reports one provider's failure beside another's threads", async () => {
    const run = vi.fn(async (command: string): Promise<ProviderResult> =>
      command === "studio-comments" ? { ok: false, error: "not logged in" } : { ok: true, answer: { threads: [{ id: "n1", line: 1 }] } },
    );
    const { call } = serve([STUDIO, NOTES], run);
    const res = await call("/api/files/browse/annotations?path=a.md");
    expect(res.status).toBe(200);
    expect(res.body.sets).toMatchObject([
      { provider: { id: "studio" }, threads: [], error: "not logged in" },
      { provider: { id: "notes" }, threads: [{ id: "n1" }], error: null },
    ]);
  });

  it("refuses a path outside the root without asking any provider", async () => {
    const run = answers({ threads: [] });
    const { call } = serve([NOTES], run);
    expect((await call("/api/files/browse/annotations?path=../outside.md")).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers as the file read does when the file cannot be read", async () => {
    const run = answers({ threads: [] });
    const { call } = serve([STUDIO], run);
    expect((await call("/api/files/browse/annotations?path=missing.md")).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("POST /api/files/browse/annotations", () => {
  const reply = { op: "reply", provider: "studio", threadId: "t1", body: "Fixed.", requestId: "r-1" };

  it("sends a reply to the provider that owns the thread and answers what it stored", async () => {
    const run = answers({ reply: { id: "r-1", author: "Me", body: "Fixed.", createdAt: "2026-10-01T00:00:00Z" } });
    const { call, dir } = serve([STUDIO, NOTES], run);
    const res = await call("/api/files/browse/annotations?path=a.md", jsonPost(reply));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, reply: { id: "r-1", author: "Me", body: "Fixed.", createdAt: "2026-10-01T00:00:00Z" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("studio-comments", expect.objectContaining({ file: path.join(dir, "a.md") }), {
      op: "reply",
      threadId: "t1",
      body: "Fixed.",
      requestId: "r-1",
    });
  });

  it("resolves a thread", async () => {
    const run = answers({});
    const { call } = serve([STUDIO], run);
    const res = await call("/api/files/browse/annotations?path=a.md", jsonPost({ op: "resolve", provider: "studio", threadId: "t1" }));
    expect(res.body).toEqual({ ok: true, reply: null });
    expect(run).toHaveBeenCalledWith("studio-comments", expect.anything(), { op: "resolve", threadId: "t1" });
  });

  // 502: this server is fine, the thing behind it is not — and its words are what the reader needs.
  it("answers the provider's refusal as the failure", async () => {
    const { call } = serve(
      [STUDIO],
      vi.fn(async (): Promise<ProviderResult> => ({ ok: false, error: "the comment is already resolved" })),
    );
    const res = await call("/api/files/browse/annotations?path=a.md", jsonPost(reply));
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "the comment is already resolved" });
  });

  // The browser names a provider by id; a command never comes from a request.
  it("refuses a provider that is not declared, and a body that is not an action", async () => {
    const run = answers({});
    const { call } = serve([STUDIO], run);
    expect((await call("/api/files/browse/annotations?path=a.md", jsonPost({ ...reply, provider: "elsewhere", command: "rm -rf /" }))).status).toBe(404);
    expect((await call("/api/files/browse/annotations?path=a.md", jsonPost({ ...reply, body: " " }))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

// Through the real browse mount and a real process: the wiring, once.
describe("the annotations route as the Files pane reaches it", () => {
  it("runs a declared provider's command against the file on disk", async () => {
    const dir = makeTempDir("mt-annot-real-");
    writeFileSync(path.join(dir, "a.md"), "one\ntwo\n");
    const script = path.join(dir, "provider.mjs");
    writeFileSync(
      script,
      `let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({ threads: [{ id: "t1", author: "Client", body: request.content.split("\\n")[1], line: 2 }] }));
});`,
    );
    const provider: AnnotationProvider = { id: "real", label: "Real", command: `"${process.execPath}" "${script}"`, extensions: ["md"] };
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups"), annotationProviders: () => [provider] });
    const res = await routeCall(app)("/api/files/browse/annotations?path=a.md");
    expect(res.body.sets).toMatchObject([{ provider: { id: "real", label: "Real" }, threads: [{ id: "t1", body: "two", line: 2 }], error: null }]);
  });

  it("has nothing to say when no provider is declared", async () => {
    const dir = makeTempDir("mt-annot-real-");
    writeFileSync(path.join(dir, "a.md"), "one\n");
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
    expect((await routeCall(app)("/api/files/browse/annotations?path=a.md")).body).toEqual({ sets: [] });
  });
});
