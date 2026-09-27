import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import CommandCell from "../../../src/components/CommandCell.vue";
import type { RunCommand } from "../../../src/components/runCommand.js";
import type { RightPane } from "../../../src/components/gridCell";

// Stub the terminal so no xterm/WebSocket is needed; it forwards the props the cell
// passes (command/connectKey), can emit "exit" to drive the re-run UI, and exposes
// readOutput() so the summarize action has captured output to send.
const CAPTURED_OUTPUT = "npm ERR! cannot find module foo";
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "command"],
    emits: ["exit"],
    template: '<div class="stub-term" />',
    methods: {
      readOutput() {
        return CAPTURED_OUTPUT;
      },
    },
  },
}));

const COMMAND: RunCommand = { source: "script", index: 2, label: "Dev server", cwd: "/work/proj" };
const mountCell = () => mount(CommandCell, { props: { expanded: false, command: COMMAND, home: "/work" } });
const term = (w: ReturnType<typeof mount>) => w.findComponent({ name: "TerminalView" });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Every tile carries the same drag handle, the command cell included — reordering is one gesture
// across the grid, not a per-cell-type feature.
describe("CommandCell drag handle", () => {
  it("carries the handle as a tile and forwards the pickup", async () => {
    const w = mountCell();
    const handle = w.get('[data-testid="cell-drag"]');
    await handle.trigger("dragstart");
    await handle.trigger("dragend");
    expect(w.emitted("drag-handle")).toHaveLength(1);
    expect(w.emitted("drag-end")).toHaveLength(1);
  });

  it("carries none while the grid is zoomed", () => {
    const w = mount(CommandCell, { props: { expanded: false, zoomed: true, command: COMMAND, home: "/work" } });
    expect(w.find('[data-testid="cell-drag"]').exists()).toBe(false);
  });
});

describe("CommandCell", () => {
  afterEach(() => vi.unstubAllGlobals());

  // #965: the whole cell — header included — sits in one wrapper, so the focus zoom can be
  // cancelled about the cell's own centre. A second element child, or content left outside the
  // wrapper, would scale with the frame and resample the terminal's canvas.
  it("keeps its whole content in the focus-zoom wrapper", () => {
    const root = mountCell().element;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].className).toContain("group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))]");
  });

  it("shows the label + dir and runs the command in its directory", () => {
    const w = mountCell();
    expect(w.find(".cell-cmd").text()).toContain("Dev server");
    expect(w.find(".cell-dir").text()).toBe("~/proj"); // ~-anchored to home
    expect(term(w).props("command")).toEqual(COMMAND);
    expect(term(w).props("cwd")).toBe("/work/proj"); // runs in the cell's dir
    expect(term(w).props("sessionId")).toBeNull(); // not a Claude session
  });

  it("offers a re-run only after the command exits, and re-running reconnects", async () => {
    const w = mountCell();
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false);

    term(w).vm.$emit("exit");
    await nextTick();
    const rerun = w.find('[aria-label="Re-run command"]');
    expect(rerun.exists()).toBe(true);

    const before = term(w).props("connectKey");
    await rerun.trigger("click");
    expect(term(w).props("connectKey")).toBe(before + 1); // forces a fresh connect
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false); // running again
  });

  it("emits toggle-expand and close from the header buttons", async () => {
    const w = mountCell();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });

  // Every chrome event reaches the parent through ONE object binding (cellShellEvents) rather than
  // a hand-written `@` line each. A key that binding gets wrong is a button that silently does
  // nothing — the collections toggle once shipped exactly that way (see cellChromeForwarding.spec)
  // — so all three are asserted at the cell, not just the two a tile can show.
  it("forwards every chrome event, including the Panel toggle", async () => {
    const w = mount(CommandCell, { props: { expanded: true, command: COMMAND, home: "/work" } });
    await w.find('[data-testid="cell-panel-btn"]').trigger("click");
    await w.find('[aria-label="Restore terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-panel")).toHaveLength(1);
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });

  // The pane is the GRID's, so whether it is open arrives as `rightPane` and has to survive two
  // hops — this cell to CellShell, CellShell through the binding — to become the Panel button's
  // pressed state. A hop that dropped it would leave a button reading "Show" over an open pane.
  it("presses the Panel button while the grid has a pane open for this cell", () => {
    const pressed = (rightPane: RightPane | null) =>
      mount(CommandCell, { props: { expanded: true, rightPane, command: COMMAND, home: "/work" } })
        .find('[data-testid="cell-panel-btn"]')
        .attributes("aria-pressed");
    expect(pressed("canvas")).toBe("true");
    expect(pressed(null)).toBe("false");
  });

  it("zooms on a header-background click in the normal grid (mirrors clicking the body)", async () => {
    const w = mountCell(); // expanded: false, zoomed: undefined → tiled grid
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail", async () => {
    const w = mount(CommandCell, { props: { expanded: false, zoomed: true, command: COMMAND, home: "/work" } });
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("does not zoom on a header-background click while expanded (restore via the ⤡ button)", async () => {
    const w = mount(CommandCell, { props: { expanded: true, command: COMMAND, home: "/work" } });
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });
});

describe("CommandCell summarize", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has no summary panel until the button is clicked", () => {
    const w = mountCell();
    expect(w.find('[aria-label="Summarize command output"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-summary"]').exists()).toBe(false);
  });

  it("posts the captured output and renders the returned summary", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ summary: "Errors: missing module foo\nSuggested fix: yarn add foo", truncated: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/command/summarize");
    const sent = JSON.parse(String(init?.body));
    expect(sent.log).toContain("npm ERR!");
    expect(typeof sent.locale).toBe("string"); // browser locale forwarded for the reply language
    expect(w.find('[data-testid="cell-summary-text"]').text()).toContain("missing module foo");
  });

  it("copies the command + summary as a prompt to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: missing module foo", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();

    await w.find('[data-testid="cell-summary-continue"]').trigger("click");
    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain("Dev server"); // the command label
    expect(copied).toContain("/work/proj"); // the command's dir
    expect(copied).toContain("missing module foo"); // the summary
    await flushPromises();
    expect(w.find('[data-testid="cell-summary-continue"]').text()).toContain("Copied");
  });

  it("does not throw when the clipboard API is unavailable (insecure origin / webview)", async () => {
    vi.stubGlobal("navigator", {}); // no `clipboard`
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: boom", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    await w.find('[data-testid="cell-summary-continue"]').trigger("click"); // must not throw
    expect(w.find('[data-testid="cell-summary-continue"]').text()).toContain("Copy"); // stays "Copy as prompt"
  });

  it("shows the truncation note when the server truncated the log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: boom", truncated: true })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-summary-note"]').exists()).toBe(true);
  });

  it("surfaces the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "summary failed: not logged in" }, 502)),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-summary-error"]').text()).toContain("not logged in");
    expect(w.find('[data-testid="cell-summary-text"]').exists()).toBe(false);
  });

  it("dismisses the summary panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "ok", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-summary"]').exists()).toBe(true);
    await w.find('[aria-label="Dismiss summary"]').trigger("click");
    expect(w.find('[data-testid="cell-summary"]').exists()).toBe(false);
  });

  // #2007, the other half: a park button once rendered here too, and clicked to nothing. Setting
  // a cell aside now lives only in a session terminal's ⋮ menu, which the command cell does not
  // put in the chrome's slot — so there is no menu here to hold it, let alone a button.
  it("offers no way to set it aside: an ephemeral run has nothing to come back to", () => {
    const w = mountCell();
    expect(w.find('[data-testid="cell-menu"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-park-btn"]').exists()).toBe(false);
  });
});
