// GET  /api/files/panel/:id/page                 a declared file panel's page, for its frame
// POST /api/files/browse/panel?cwd=&path=        the page's question, answered by its command
//
// The server's side of file panels (common/filePanels.ts). Neither route takes a path or a command
// from the request: both look the panel up by id in the list the user wrote in the global config.
//
// The page is served under a policy that gives it NO network of its own — no fetch, no images or
// scripts from elsewhere, no forms, no navigation target. Everything it learns comes from the pane
// by message, and everything it reaches goes through the POST below to the one command its entry
// names. The frame's own `sandbox` attribute says the same; the header is here so that opening the
// URL directly is no different.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";
import { readPanelRequest, type FilePanel } from "../../common/filePanels.js";
import { resolveContained } from "./pathContainment.js";
import { runPanelCommand, type PanelCommandFile, type PanelCommandResult } from "./file-panel-command.js";

export interface FilePanelRouteDeps {
  /** The browse base for a raw `?cwd=` value. */
  base: (cwd: unknown) => string;
  /** The file's text, or null with the response already answered (directory, too large, binary,
   *  missing) — the browse routes' own reader, so those read the same here. */
  readText: (res: Response, abs: string) => string | null;
  /** The declared panels, read per request so a config change needs no restart. */
  panels: () => FilePanel[];
  /** Replaced in specs; the real one spawns the panel's command. */
  run?: (command: string, target: PanelCommandFile, payload: unknown) => Promise<PanelCommandResult>;
}

// A page is a document somebody wrote by hand; one this large is a mistake, not a panel.
export const PANEL_PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** The policy a panel's page runs under. `'unsafe-inline'` because the page is ONE file — there is
 *  nowhere else for its script and style to be — and `data:` so it can carry its own images. */
export const PANEL_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
  "sandbox allow-scripts",
].join("; ");

/** The file a request names, or null with the response already answered. */
function targetFor(req: Request, res: Response, deps: FilePanelRouteDeps): PanelCommandFile | null {
  const root = path.resolve(deps.base(req.query.cwd));
  const abs = resolveContained(root, typeof req.query.path === "string" ? req.query.path : "", os.homedir());
  if (!abs) {
    res.status(403).json({ error: "path escapes the project root" });
    return null;
  }
  const content = deps.readText(res, abs);
  if (content === null) return null;
  return { file: abs, root, path: path.relative(root, abs).split(path.sep).join("/"), content };
}

/** The page's bytes, or null when the declared file is not there or is not a reasonable page. */
function readPage(panel: FilePanel): Buffer | null {
  try {
    const stat = fs.statSync(panel.page);
    return stat.isFile() && stat.size <= PANEL_PAGE_MAX_BYTES ? fs.readFileSync(panel.page) : null;
  } catch {
    return null;
  }
}

export function mountFilePanelRoutes(app: Express, deps: FilePanelRouteDeps): void {
  const run = deps.run ?? runPanelCommand;
  const panelNamed = (id: unknown): FilePanel | undefined => deps.panels().find((panel) => panel.id === id);

  app.get("/api/files/panel/:id/page", (req, res) => {
    const panel = panelNamed(req.params.id);
    const page = panel ? readPage(panel) : null;
    if (!page) return res.status(404).json({ error: "no such file panel, or its page cannot be read" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", PANEL_PAGE_CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Read from disk on every load: the page is something its author is editing.
    res.setHeader("Cache-Control", "no-store");
    res.send(page);
  });

  app.post("/api/files/browse/panel", async (req, res) => {
    const request = readPanelRequest(req.body);
    if (!request) return res.status(400).json({ error: "expected a panel and a payload" });
    const panel = panelNamed(request.panel);
    if (!panel) return res.status(404).json({ error: "no such file panel" });
    if (!panel.command) return res.status(404).json({ error: "this file panel has no command" });
    const target = targetFor(req, res, deps);
    if (!target) return;
    const answer = await run(panel.command, target, request.payload);
    // 502: this server is fine, the thing behind it is not — and its own words are what the page
    // has to show.
    if (!answer.ok) return res.status(502).json({ error: answer.error });
    res.json({ ok: true, result: answer.result });
  });
}
