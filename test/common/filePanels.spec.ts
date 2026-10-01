import { describe, it, expect } from "vitest";
import {
  FILE_PANELS_MAX,
  FILE_PANEL_FROM_PAGE,
  PANEL_MARKS_MAX,
  panelCoversFile,
  readFilePanelPageMessage,
  readPanelMarks,
  readPanelRequest,
  sanitizeFilePanels,
} from "../../common/filePanels";

const panel = (over: Record<string, unknown> = {}) => ({
  id: "studio",
  label: "Studio",
  page: "/opt/studio/panel.html",
  command: "node /opt/studio/command.mjs",
  extensions: ["md"],
  ...over,
});
const fromPage = (body: Record<string, unknown>) => readFilePanelPageMessage({ source: FILE_PANEL_FROM_PAGE, ...body });

describe("sanitizeFilePanels", () => {
  it("keeps a well-formed entry as written", () => {
    expect(sanitizeFilePanels([panel()])).toEqual([panel()]);
  });

  it("is an empty list for anything that is not a list", () => {
    expect(sanitizeFilePanels(undefined)).toEqual([]);
    expect(sanitizeFilePanels({ id: "studio" })).toEqual([]);
  });

  // A relative page has no directory it could honestly be relative to; resolving one against a
  // guess is how a different file ends up in the frame.
  it("drops an entry whose page is not an absolute path, or whose id cannot travel", () => {
    expect(
      sanitizeFilePanels([panel({ page: "panel.html" }), panel({ page: "~/panel.html" }), panel({ page: "" }), panel({ id: "Has Space" }), panel({ id: 7 })]),
    ).toEqual([]);
    expect(sanitizeFilePanels([panel({ page: "C:\\studio\\panel.html" })])).toHaveLength(1);
  });

  // A page that only marks lines from what it is told needs no command.
  it("keeps a panel with no command, and names one after its id when it has no label", () => {
    expect(sanitizeFilePanels([panel({ command: "  ", label: undefined })])[0]).toMatchObject({ command: null, label: "studio" });
  });

  it("reads extensions without their dot, lower-cased, once each", () => {
    expect(sanitizeFilePanels([panel({ extensions: [".MD", "md", "mdx", "*.txt", 3] })])[0]?.extensions).toEqual(["md", "mdx"]);
  });

  it("keeps the first entry of a repeated id, and no more than the limit", () => {
    const many = Array.from({ length: FILE_PANELS_MAX + 3 }, (_, i) => panel({ id: `p${i}` }));
    expect(sanitizeFilePanels([panel({ label: "First" }), panel({ label: "Second" })]).map((kept) => kept.label)).toEqual(["First"]);
    expect(sanitizeFilePanels(many)).toHaveLength(FILE_PANELS_MAX);
  });
});

describe("panelCoversFile", () => {
  const [md] = sanitizeFilePanels([panel()]);
  const [any] = sanitizeFilePanels([panel({ extensions: [] })]);
  if (!md || !any) throw new Error("fixture");

  it("puts a panel only beside the extensions it named", () => {
    expect(panelCoversFile(md, "docs/Script.MD")).toBe(true);
    expect(panelCoversFile(md, "src/a.ts")).toBe(false);
    expect(panelCoversFile(md, "Makefile")).toBe(false);
  });

  it("puts a panel that named none beside every file", () => {
    expect(panelCoversFile(any, "Makefile")).toBe(true);
  });
});

describe("readPanelMarks", () => {
  it("reads a mark, ending where it starts unless told otherwise", () => {
    expect(
      readPanelMarks([
        { id: "a", line: 4 },
        { id: "b", line: 2, endLine: 5 },
      ]),
    ).toEqual([
      { id: "a", line: 4, endLine: 4 },
      { id: "b", line: 2, endLine: 5 },
    ]);
  });

  // A mark is a line and an id. Without either there is nothing to draw or to report a click on.
  it("drops a mark with no id or no real line, and the second of a repeated id", () => {
    expect(
      readPanelMarks([
        { line: 1 },
        { id: "", line: 1 },
        { id: "a", line: 0 },
        { id: "b", line: 1.5 },
        { id: "c", line: "3" },
        { id: "d", line: 2 },
        { id: "d", line: 9 },
      ]),
    ).toEqual([{ id: "d", line: 2, endLine: 2 }]);
  });

  it("does not let a mark end before it starts", () => {
    expect(readPanelMarks([{ id: "a", line: 4, endLine: 2 }])).toEqual([{ id: "a", line: 4, endLine: 4 }]);
  });

  it("is empty for anything that is not a list, and keeps no more than the limit", () => {
    expect(readPanelMarks("marks")).toEqual([]);
    expect(readPanelMarks(Array.from({ length: PANEL_MARKS_MAX + 10 }, (_, i) => ({ id: `m${i}`, line: i + 1 })))).toHaveLength(PANEL_MARKS_MAX);
  });
});

describe("readFilePanelPageMessage", () => {
  it("reads each thing a page can say", () => {
    expect(fromPage({ kind: "ready" })).toEqual({ kind: "ready" });
    expect(fromPage({ kind: "show", visible: true })).toEqual({ kind: "show", visible: true });
    expect(fromPage({ kind: "marks", marks: [{ id: "a", line: 1 }] })).toEqual({ kind: "marks", marks: [{ id: "a", line: 1, endLine: 1 }] });
    expect(fromPage({ kind: "reveal", line: 12 })).toEqual({ kind: "reveal", line: 12 });
    expect(fromPage({ kind: "request", requestId: "r1", payload: { op: "list" } })).toEqual({ kind: "request", requestId: "r1", payload: { op: "list" } });
    expect(fromPage({ kind: "insert", text: "@a.md fix this" })).toEqual({ kind: "insert", text: "@a.md fix this" });
  });

  // Only an explicit `true` takes room: a page that sent something else has not asked to be shown.
  it("shows a panel only when told exactly that", () => {
    expect(fromPage({ kind: "show", visible: "yes" })).toEqual({ kind: "show", visible: false });
    expect(fromPage({ kind: "show" })).toEqual({ kind: "show", visible: false });
  });

  it("refuses what is not one of those, or is one without what it needs", () => {
    expect(readFilePanelPageMessage({ kind: "ready" })).toBeNull(); // not tagged as a panel's
    expect(readFilePanelPageMessage({ source: "someone-else", kind: "ready" })).toBeNull();
    expect(readFilePanelPageMessage("ready")).toBeNull();
    expect(fromPage({ kind: "eval", code: "alert(1)" })).toBeNull();
    expect(fromPage({ kind: "reveal", line: 0 })).toBeNull();
    expect(fromPage({ kind: "request", payload: {} })).toBeNull();
    expect(fromPage({ kind: "insert", text: "   " })).toBeNull();
    expect(fromPage({ kind: "insert", text: 5 })).toBeNull();
  });
});

describe("readPanelRequest", () => {
  it("reads which panel is asking, with whatever it asked", () => {
    expect(readPanelRequest({ panel: "studio", payload: { op: "list" } })).toEqual({ panel: "studio", payload: { op: "list" } });
    expect(readPanelRequest({ panel: "studio" })).toEqual({ panel: "studio", payload: undefined });
  });

  it("refuses a body that names no panel", () => {
    expect(readPanelRequest({ payload: {} })).toBeNull();
    expect(readPanelRequest({ panel: "" })).toBeNull();
    expect(readPanelRequest(null)).toBeNull();
  });
});
