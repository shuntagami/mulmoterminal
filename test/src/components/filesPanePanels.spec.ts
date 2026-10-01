import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import FilesPane from "../../../src/components/FilesPane.vue";
import { filePanels } from "../../../src/composables/filePanels";
import { lineMarksOf } from "../../../src/composables/useFilesPanePanels";
import { FILE_PANEL_FROM_PAGE, type FilePanelHostMessage } from "../../../common/filePanels";

// A file panel in the pane: the user's page beside the SOURCE of a file it covers, able to mark
// lines, move the editor, question its command and put text at the terminal — and nothing else.
const fakeEditor = fakeCmEditor("# Title\n\nbody");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});
const posted: FilePanelHostMessage[] = [];
vi.mock("../../../src/utils/filePanelFrame", () => ({
  postToFilePanel: (_frame: unknown, message: FilePanelHostMessage) => posted.push(message),
}));

let panelPosts: { path: string | null; body: unknown }[] = [];

function serve(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://x");
    if (url.pathname.endsWith("/browse/panel")) {
      panelPosts.push({ path: url.searchParams.get("path"), body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { threads: 2 } }) };
    }
    if (url.pathname.includes("/list")) return { ok: true, json: async () => ({ entries: [{ name: "a.md", dir: false, size: 1 }] }) };
    if (url.pathname.includes("/text")) return { ok: true, json: async () => ({ text: "# Title\n\nbody", version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true, version: "v1" }) };
  }) as unknown as typeof fetch;
}

const mountPane = async (path = "a.md", insertTarget = true) => {
  const w = mount(FilesPane, {
    props: { cwd: "/proj", insertTarget, insertTargetCwd: "/proj", initialState: { tabs: [{ path }], activePath: path, expanded: [] } },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};
const frameOf = (w: ReturnType<typeof mount>) => w.find<HTMLIFrameElement>('[data-testid="file-panel-studio"]');
/** A message as the panel's page would post it. */
async function say(w: ReturnType<typeof mount>, body: Record<string, unknown>): Promise<void> {
  window.dispatchEvent(new MessageEvent("message", { data: { source: FILE_PANEL_FROM_PAGE, ...body }, source: frameOf(w).element.contentWindow }));
  await flushPromises();
}
const modeButton = (w: ReturnType<typeof mount>) => w.findAll("button").find((button) => button.text() === "Preview" || button.text() === "Edit");
const columnShown = (w: ReturnType<typeof mount>) => !(w.get('[data-testid="file-panels"]').attributes("style") ?? "").includes("display: none");

describe("lineMarksOf", () => {
  // Two panels may both call a mark "a"; the key is what keeps them apart in the editor.
  it("gives the editor every panel's marks under keys that cannot collide", () => {
    expect(lineMarksOf({ studio: [{ id: "a", line: 3, endLine: 5 }], lint: [{ id: "a", line: 1, endLine: 1 }] })).toEqual([
      { line: 3, span: 3, keys: ["studio:a"] },
      { line: 1, span: 1, keys: ["lint:a"] },
    ]);
  });
});

describe("a file panel in the Files pane", () => {
  beforeEach(() => {
    localStorage.clear();
    panelPosts = [];
    posted.length = 0;
    filePanels.value = [{ id: "studio", label: "Studio", page: "/opt/panel.html", command: "studio", extensions: ["md"] }];
    fakeEditor.setLineMarks.mockClear();
    fakeEditor.revealLine.mockClear();
    fakeEditor.lineMarkLine.mockReset().mockReturnValue(null);
    serve();
  });
  afterEach(() => {
    filePanels.value = [];
    document.body.innerHTML = "";
  });

  // Loaded and listening, but taking no room until its page says it has something for this file.
  it("loads a covering panel's page beside the source and gives it room only when it asks", async () => {
    const w = await mountPane();
    expect(frameOf(w).exists()).toBe(true);
    expect(columnShown(w)).toBe(false);
    await say(w, { kind: "ready" });
    expect(posted.at(-1)).toMatchObject({ kind: "file", file: { path: "a.md", root: "/proj", content: "# Title\n\nbody", reference: "@a.md" } });
    await say(w, { kind: "show", visible: true });
    expect(columnShown(w)).toBe(true);
  });

  it("loads nothing for a file no panel covers, or where none is declared", async () => {
    const other = await mountPane("a.ts");
    expect(other.find('[data-testid="file-panels"]').exists()).toBe(false);
    filePanels.value = [];
    const none = await mountPane();
    expect(none.find('[data-testid="file-panels"]').exists()).toBe(false);
  });

  it("marks the lines the page asks for, and tells the page which mark was clicked", async () => {
    const w = await mountPane();
    await say(w, { kind: "ready" });
    await say(w, { kind: "marks", marks: [{ id: "t1", line: 3 }] });
    const [marks, onPick] = fakeEditor.setLineMarks.mock.calls.at(-1) ?? [];
    expect(marks).toEqual([{ line: 3, span: 1, keys: ["studio:t1"] }]);
    (onPick as (key: string) => void)("studio:t1");
    await flushPromises();
    expect(posted.at(-1)).toEqual({ kind: "mark-clicked", id: "t1" });
  });

  it("moves the editor to the line the page names", async () => {
    const w = await mountPane();
    await say(w, { kind: "reveal", line: 3 });
    expect(fakeEditor.revealLine).toHaveBeenCalledWith(3);
  });

  // The page has no network. Its questions go to its own command, about the open file.
  it("carries the page's request to its command and the answer back", async () => {
    const w = await mountPane();
    await say(w, { kind: "ready" });
    await say(w, { kind: "request", requestId: "r1", payload: { op: "list" } });
    expect(panelPosts).toEqual([{ path: "a.md", body: { panel: "studio", payload: { op: "list" } } }]);
    expect(posted.at(-1)).toEqual({ kind: "response", requestId: "r1", ok: true, result: { threads: 2 } });
  });

  // At the prompt for the reader to send — the @ button's path, and its rule about saving first.
  it("puts the page's text at the prompt of the terminal beside it", async () => {
    const w = await mountPane();
    await say(w, { kind: "insert", text: "@a.md fix line 3" });
    expect(w.emitted("insert-text")?.[0]).toEqual(["@a.md fix line 3"]);
  });

  it("inserts nothing, and names no reference, where there is no terminal beside the pane", async () => {
    const w = await mountPane("a.md", false);
    await say(w, { kind: "ready" });
    expect(posted.at(-1)).toMatchObject({ kind: "file", file: { reference: null } });
    await say(w, { kind: "insert", text: "@a.md fix line 3" });
    expect(w.emitted("insert-text")).toBeUndefined();
  });

  // The Preview is another document with no lines for a mark to be on.
  it("takes the panel and its marks away while the Markdown is previewed", async () => {
    const w = await mountPane();
    await say(w, { kind: "ready" });
    await say(w, { kind: "marks", marks: [{ id: "t1", line: 3 }] });
    await modeButton(w)?.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="file-panels"]').exists()).toBe(false);
    expect(fakeEditor.setLineMarks.mock.calls.at(-1)?.[0]).toEqual([]);
    await modeButton(w)?.trigger("click");
    await flushPromises();
    expect(frameOf(w).exists()).toBe(true);
  });
});
