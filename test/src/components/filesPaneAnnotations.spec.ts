import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import FilesPane from "../../../src/components/FilesPane.vue";
import { annotationProviders } from "../../../src/composables/annotationProviders";

// The pane's comments: shown beside the SOURCE of a file a declared provider covers, and nowhere else.
const fakeEditor = fakeCmEditor("# Title\n\nbody");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

const THREADS = [{ id: "t1", author: "Client", body: "Too long.", line: 3, quote: "body", canResolve: true }];
let annotationReads: string[] = [];

function serve(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://x");
    if (url.pathname.endsWith("/annotations")) {
      annotationReads.push(url.searchParams.get("path") ?? "");
      return {
        ok: true,
        status: 200,
        json: async () => ({ sets: [{ provider: { id: "studio", label: "Studio" }, threads: THREADS, instructions: "Sync first.", error: null }] }),
      };
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

const modeButton = (w: ReturnType<typeof mount>) => w.findAll("button").find((button) => button.text() === "Preview" || button.text() === "Edit");

describe("the Files pane's comments", () => {
  beforeEach(() => {
    localStorage.clear();
    annotationReads = [];
    annotationProviders.value = [{ id: "studio", label: "Studio", command: "studio", extensions: ["md"] }];
    fakeEditor.setAnnotations.mockClear();
    fakeEditor.revealLine.mockClear();
    serve();
  });
  afterEach(() => {
    annotationProviders.value = [];
    document.body.innerHTML = "";
  });

  it("shows the open file's comments beside the source and marks their lines in the editor", async () => {
    const w = await mountPane();
    expect(annotationReads).toEqual(["a.md"]);
    expect(w.get('[data-testid="file-annotation-thread"]').text()).toContain("Too long.");
    expect(fakeEditor.setAnnotations.mock.calls.at(-1)?.[0]).toEqual([{ line: 3, span: 1, keys: ["studio:t1"] }]);
  });

  // The Preview is another document with no lines to hang a comment on.
  it("hides the comments while the Markdown is previewed, and brings them back with the source", async () => {
    const w = await mountPane();
    await modeButton(w)?.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="file-annotations"]').exists()).toBe(false);
    await modeButton(w)?.trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="file-annotations"]').exists()).toBe(true);
  });

  it("reads nothing and shows nothing where no provider is declared", async () => {
    annotationProviders.value = [];
    const w = await mountPane();
    expect(annotationReads).toEqual([]);
    expect(w.find('[data-testid="file-annotations"]').exists()).toBe(false);
  });

  it("goes to a thread's line in the editor when its place is clicked", async () => {
    const w = await mountPane();
    await w.get('[data-testid="file-annotation-where"]').trigger("click");
    expect(fakeEditor.revealLine).toHaveBeenCalledWith(3);
  });

  // Put at the prompt for the reader to send — with the file, the provider's instructions, and the
  // id the agent needs to answer the thread through the provider's own tools.
  it("hands a thread to the agent beside it as a request at the prompt", async () => {
    const w = await mountPane();
    await w.get('[data-testid="file-annotation-ask"]').trigger("click");
    await flushPromises();
    const [text] = w.emitted("insert-text")?.[0] ?? [];
    expect(text).toContain("@a.md has review comments.");
    expect(text).toContain("Sync first.");
    expect(text).toContain("1. line 3 — Client [Studio] / thread id: t1");
  });

  it("offers no hand-off where there is no terminal beside the pane", async () => {
    const w = await mountPane("a.md", false);
    expect(w.find('[data-testid="file-annotation-thread"]').exists()).toBe(true);
    expect(w.find('[data-testid="file-annotation-ask"]').exists()).toBe(false);
  });
});
