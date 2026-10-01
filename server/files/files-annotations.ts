// GET  /api/files/browse/annotations?cwd=&path=   the comments on a file, from every provider that
//                                                 covers it
// POST /api/files/browse/annotations?cwd=&path=   reply to a thread, or resolve it
//
// The Files pane's side of file annotations (common/fileAnnotations.ts). Both take the browse
// routes' base and containment: a provider is told about a file only when the pane could have
// opened it. The GET is a read for the reason `/lines` is — looking at comments is not opening the
// file, so no backup rotates.
//
// A provider failing is NOT a failed request. The GET answers 200 with that provider's `error`
// beside the others' threads, because one source being down must not hide the rest; the POST has
// exactly one provider to ask, so its failure is the response's (502: this server is fine, the
// thing behind it is not).
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import {
  providerCoversFile,
  readAnnotationAction,
  readAnnotationReply,
  readAnnotationThreads,
  ANNOTATION_INSTRUCTIONS_MAX,
  type AnnotationProvider,
  type FileAnnotationSet,
} from "../../common/fileAnnotations.js";
import { resolveContained } from "./pathContainment.js";
import { runAnnotationProvider, type ProviderFile, type ProviderRequest, type ProviderResult } from "./annotation-provider.js";

export interface FilesAnnotationsDeps {
  /** The browse base for a raw `?cwd=` value. */
  base: (cwd: unknown) => string;
  /** The file's text, or null with the response already answered (directory, too large, binary,
   *  missing) — the browse routes' own reader, so those read the same here. */
  readText: (res: Response, abs: string) => string | null;
  /** The declared providers, read per request so a config change needs no restart. */
  providers: () => AnnotationProvider[];
  /** Replaced in specs; the real one spawns the provider's command. */
  run?: (command: string, target: ProviderFile, request: ProviderRequest) => Promise<ProviderResult>;
}

/** The file a request names, or null with the response already answered. */
function targetFor(req: Request, res: Response, deps: FilesAnnotationsDeps): ProviderFile | null {
  const root = deps.base(req.query.cwd);
  const abs = resolveContained(root, typeof req.query.path === "string" ? req.query.path : "", os.homedir());
  if (!abs) {
    res.status(403).json({ error: "path escapes the project root" });
    return null;
  }
  const content = deps.readText(res, abs);
  if (content === null) return null;
  return { file: abs, root: path.resolve(root), path: path.relative(path.resolve(root), abs).split(path.sep).join("/"), content };
}

const setFrom = (provider: AnnotationProvider, result: ProviderResult): FileAnnotationSet => {
  const about = { id: provider.id, label: provider.label };
  if (!result.ok) return { provider: about, threads: [], instructions: null, error: result.error };
  const instructions = typeof result.answer.instructions === "string" ? result.answer.instructions.slice(0, ANNOTATION_INSTRUCTIONS_MAX) : "";
  return { provider: about, threads: readAnnotationThreads(result.answer.threads), instructions: instructions || null, error: null };
};

export function mountFilesAnnotationsRoute(app: Express, deps: FilesAnnotationsDeps): void {
  const run = deps.run ?? runAnnotationProvider;

  app.get("/api/files/browse/annotations", async (req, res) => {
    // Asked before the file is read: with nothing declared for this kind of file there is nothing
    // to run, and the common case — no providers at all — should cost no disk read.
    const name = typeof req.query.path === "string" ? req.query.path : "";
    const covering = deps.providers().filter((provider) => providerCoversFile(provider, name));
    if (covering.length === 0) return res.json({ sets: [] });
    const target = targetFor(req, res, deps);
    if (!target) return;
    const sets = await Promise.all(covering.map(async (provider) => setFrom(provider, await run(provider.command, target, { op: "list" }))));
    res.json({ sets });
  });

  app.post("/api/files/browse/annotations", async (req, res) => {
    const action = readAnnotationAction(req.body);
    if (!action) return res.status(400).json({ error: "expected a reply or a resolve for a thread" });
    const provider = deps.providers().find((entry) => entry.id === action.provider);
    if (!provider) return res.status(404).json({ error: "no such annotation provider" });
    const target = targetFor(req, res, deps);
    if (!target) return;
    const request: ProviderRequest =
      action.op === "reply"
        ? { op: "reply", threadId: action.threadId, body: action.body, requestId: action.requestId }
        : { op: "resolve", threadId: action.threadId };
    const result = await run(provider.command, target, request);
    if (!result.ok) return res.status(502).json({ error: result.error });
    // What the provider stored, when it says: the author and time are its to decide. Null leaves
    // the pane to re-read the thread, which is always correct and one round trip slower.
    res.json({ ok: true, reply: action.op === "reply" ? readAnnotationReply(result.answer.reply) : null });
  });
}
