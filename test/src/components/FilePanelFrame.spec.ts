import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { FILE_PANEL_FROM_PAGE, type FilePanel, type FilePanelHostMessage } from "../../../common/filePanels";
import type { PanelRequestOutcome } from "../../../src/components/FilePanelFrame.vue";

// What the pane says into the frame, captured instead of posted: jsdom's frame has no page to hear it.
const posted: FilePanelHostMessage[] = [];
vi.mock("../../../src/utils/filePanelFrame", () => ({
  postToFilePanel: (_frame: unknown, message: FilePanelHostMessage) => posted.push(message),
}));

const FilePanelFrame = (await import("../../../src/components/FilePanelFrame.vue")).default;

const PANEL: FilePanel = { id: "studio", label: "Studio", page: "/opt/panel.html", command: "studio", extensions: ["md"] };
const FILE = { path: "docs/a.md", root: "/proj", reference: "@docs/a.md" };

function mountFrame(over: Record<string, unknown> = {}) {
  const request = vi.fn(async (): Promise<PanelRequestOutcome> => ({ ok: true, result: { threads: [] } }));
  const w = mount(FilePanelFrame, {
    props: { panel: PANEL, file: FILE, diskVersion: "v1", content: () => "one\ntwo", theme: null, markLines: {}, clicked: null, request, ...over },
    attachTo: document.body,
  });
  const frame = w.get("iframe").element as HTMLIFrameElement;
  /** A message as the page would post it — from the frame's own window. */
  const say = (body: Record<string, unknown>, source: MessageEventSource | null = frame.contentWindow) =>
    window.dispatchEvent(new MessageEvent("message", { data: { source: FILE_PANEL_FROM_PAGE, ...body }, source }));
  return { w, say, request };
}

describe("FilePanelFrame", () => {
  beforeEach(() => {
    posted.length = 0;
  });

  // The page is somebody's own code: opaque-origin is what keeps it out of this app's storage and API.
  it("loads the panel's page in a frame that may run scripts and nothing else", () => {
    const { w } = mountFrame();
    const frame = w.get("iframe");
    expect(frame.attributes("src")).toBe("/api/files/panel/studio/page");
    expect(frame.attributes("sandbox")).toBe("allow-scripts");
    expect(frame.attributes("title")).toBe("Studio");
  });

  // A message posted into a frame that is still loading is delivered to nobody.
  it("says nothing until the page is ready, then tells it the open file", async () => {
    const { w, say } = mountFrame();
    await w.setProps({ diskVersion: "v2" });
    expect(posted).toEqual([]);
    say({ kind: "ready" });
    expect(posted).toEqual([{ kind: "file", version: 1, file: { ...FILE, content: "one\ntwo" }, theme: null }]);
  });

  it("tells the page again when the file changes on disk, with the text as it is then", async () => {
    let text = "one";
    const { w, say } = mountFrame({ content: () => text });
    say({ kind: "ready" });
    text = "one\nthree";
    await w.setProps({ diskVersion: "v2" });
    expect(posted.at(-1)).toMatchObject({ kind: "file", version: 2, file: { content: "one\nthree" } });
  });

  // What the page said about the last file is about text that is no longer on screen. Cleared
  // before the page hears of the new one, so a slow page cannot leave old marks on a new file.
  it("clears the last file's marks and room when another file is opened", async () => {
    const { w, say } = mountFrame();
    say({ kind: "ready" });
    await w.setProps({ file: { ...FILE, path: "docs/b.md", reference: "@docs/b.md" } });
    expect(w.emitted("marks")?.at(-1)).toEqual([[]]);
    expect(w.emitted("visible")?.at(-1)).toEqual([false]);
    expect(posted.at(-1)).toMatchObject({ kind: "file", file: { path: "docs/b.md" } });
  });

  it("passes on what the page asks for: room, marks, a line to go to, text for the terminal", () => {
    const { w, say } = mountFrame();
    say({ kind: "show", visible: true });
    say({ kind: "marks", marks: [{ id: "a", line: 3 }, { line: 9 }] });
    say({ kind: "reveal", line: 3 });
    say({ kind: "insert", text: "@docs/a.md fix line 3" });
    expect(w.emitted("visible")).toEqual([[true]]);
    expect(w.emitted("marks")).toEqual([[[{ id: "a", line: 3, endLine: 3 }]]]);
    expect(w.emitted("reveal")).toEqual([[3]]);
    expect(w.emitted("insert")).toEqual([["@docs/a.md fix line 3"]]);
  });

  it("answers the page's request with what its command said, under the same id", async () => {
    const { say, request } = mountFrame();
    say({ kind: "ready" });
    say({ kind: "request", requestId: "r7", payload: { op: "list" } });
    await flushPromises();
    expect(request).toHaveBeenCalledWith({ op: "list" });
    expect(posted.at(-1)).toEqual({ kind: "response", requestId: "r7", ok: true, result: { threads: [] } });
  });

  it("answers a request that failed with why", async () => {
    const { say } = mountFrame({ request: vi.fn(async (): Promise<PanelRequestOutcome> => ({ ok: false, error: "no token" })) });
    say({ kind: "request", requestId: "r8", payload: {} });
    await flushPromises();
    expect(posted.at(-1)).toEqual({ kind: "response", requestId: "r8", ok: false, error: "no token" });
  });

  it("tells the page where its marks are now, and which was clicked", async () => {
    const { w, say } = mountFrame();
    say({ kind: "ready" });
    await w.setProps({ markLines: { a: 5 } });
    await w.setProps({ clicked: { id: "a" } });
    expect(posted.slice(-2)).toEqual([
      { kind: "mark-lines", lines: { a: 5 } },
      { kind: "mark-clicked", id: "a" },
    ]);
  });

  // Who is speaking is decided by the window the message came from, not by what it says.
  it("ignores a message from any window but its own frame, and one that is not a panel's", () => {
    const { w, say } = mountFrame();
    say({ kind: "show", visible: true }, window);
    window.dispatchEvent(
      new MessageEvent("message", { data: { kind: "show", visible: true }, source: (w.get("iframe").element as HTMLIFrameElement).contentWindow }),
    );
    say({ kind: "eval", code: "alert(1)" });
    expect(w.emitted()).toEqual({});
    expect(posted).toEqual([]);
  });

  it("takes its marks with it when it goes, and stops listening", () => {
    const { w, say } = mountFrame();
    w.unmount();
    expect(w.emitted("marks")?.at(-1)).toEqual([[]]);
    say({ kind: "show", visible: true });
    expect(w.emitted("visible")).toBeUndefined();
  });
});
