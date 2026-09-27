import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, type VNode } from "vue";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";
import { mountRequests } from "../../helpers/mountRequests";

// Opening the files pane on the enlarged cell, from the entrances that are left. The path menu's
// "Browse files in the app" (#1910), which enlarged a tiled cell AND opened the pane in one
// gesture, is gone: the header's Panel button and the side pane's tabs are the way to Files now,
// and neither enlarges anything — pressed on a tile, the Panel button only records what that cell
// wants (#1378, pinned in TerminalGrid.spec.ts). What remains here is the Panel button and the
// `files-find` shortcut, under the strict request harness: neither may send the grid asking about
// a cell the zoom is not on.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const flush = vi.fn(async () => undefined as boolean | undefined);
const openFinder = vi.fn();

vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "rightPane"],
    emits: ["toggle-expand", "toggle-panel", "open-canvas", "session", "cwd", "close", "status"],
    template: '<div class="stub-cell" />',
  },
}));
vi.mock("../../../src/components/CommandCell.vue", () => ({
  default: { name: "CommandCell", props: ["expanded", "command"], emits: ["toggle-expand", "toggle-panel", "close", "status"], template: "<div />" },
}));
vi.mock("../../../src/components/LauncherCell.vue", () => ({
  default: {
    name: "LauncherCell",
    props: ["expanded", "launcher"],
    emits: ["toggle-expand", "toggle-panel", "close", "status", "session"],
    template: "<div />",
  },
}));
vi.mock("../../../src/components/FilesPane.vue", () => ({
  default: {
    name: "FilesPane",
    props: ["cwd", "requestedPath", "initialState", "canvasTarget", "workspace"],
    emits: ["close", "dirty", "open-in-canvas"],
    setup: (_p: unknown, { expose, slots }: { expose: (e: Record<string, unknown>) => void; slots: { title?: () => VNode[] } }) => {
      expose({ flush, reload: () => {}, snapshot: () => ({ openPath: null, expanded: [] }), openFinder });
      return () => h("div", { class: "stub-files-pane" }, slots.title?.());
    },
  },
}));

const cell = (uid: number, session: string, cwd: string): Cell => ({ uid, session, cwd });

// One list, so the grid's cells and the routes the guard will accept cannot drift apart.
const CELLS = [cell(1, "s1", "/work/a"), cell(2, "s2", "/work/b")];
// `?? []` rather than a cast: `Cell.session` is nullable, and a cell without one contributes no
// route — which is the right answer, not something to assert away. Same idiom as listSlots.
const SESSIONS = CELLS.flatMap((c) => c.session ?? []);

const requests = mountRequests(SESSIONS, { strict: true });

const sessionOf = (uid: number) => CELLS.find((c) => c.uid === uid)?.session ?? "";

const mountGrid = () => {
  requests.enlarge(sessionOf(1));
  return mount(TerminalGrid, {
    props: {
      cells: CELLS,
      expandedUid: 1,
      listRows: [],
      cancelUid: null,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable: false,
      listMode: true,
    },
    attachTo: document.body,
  });
};

type Grid = ReturnType<typeof mountGrid>;
const cells = (w: Grid) => w.findAllComponents({ name: "TerminalCell" });
const filesPane = (w: Grid) => w.findComponent({ name: "FilesPane" });

describe("opening the files pane on the enlarged cell", () => {
  beforeEach(() => {
    localStorage.clear();
    requests.install();
    flush.mockClear();
    flush.mockResolvedValue(undefined);
    openFinder.mockClear();
    // The zoom-flip watcher asks for the reduced-motion preference the moment `expandedUid`
    // moves, which is exactly what the tiled case here does.
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    }
  });

  // Awaited first: a mount effect that fires late would otherwise be read before it has run, and
  // the check would pass for the request it exists to catch.
  afterEach(async () => {
    await flushPromises();
    requests.settled();
  });

  // The Panel button reopens the pane used last, which on a grid that has shown none is Files.
  it("opens the pane from the Panel button without asking to enlarge again", async () => {
    const w = mountGrid();
    cells(w)[0].vm.$emit("toggle-panel");
    await flushPromises();

    expect(w.emitted("toggle-expand")).toBeUndefined();
    expect(filesPane(w).exists()).toBe(true);
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    w.unmount();
  });

  // The `files-find` shortcut (#2099). It has to work from a cell with NO pane open — that is the
  // request: "ファイルペインを開いていない状態でショートカットを押した場合は、いま見ているセルの
  // 作業ディレクトリを対象にファイルペインが開いて、そのまま検索できる".
  it("opens the pane on the enlarged cell and then the finder, from a grid with no pane up", async () => {
    const w = mountGrid();
    expect(filesPane(w).exists()).toBe(false);

    await (w.vm as unknown as { openFilesFinder: () => Promise<void> }).openFilesFinder();
    await flushPromises();

    expect(filesPane(w).exists()).toBe(true);
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    expect(openFinder).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  // Not a toggle, unlike the Panel button: the shortcut is "show me", so a pane that is already up
  // stays up and stays where it is.
  it("just opens the finder when the pane is already up, leaving the pane where it is", async () => {
    const w = mountGrid();
    cells(w)[0].vm.$emit("toggle-panel");
    await flushPromises();
    expect(filesPane(w).exists()).toBe(true); // or "already up" is not what this tests
    flush.mockClear();

    await (w.vm as unknown as { openFilesFinder: () => Promise<void> }).openFilesFinder();
    await flushPromises();

    expect(openFinder).toHaveBeenCalledTimes(1);
    expect(filesPane(w).exists()).toBe(true);
    expect(filesPane(w).props("cwd")).toBe("/work/a");
    // Nothing unmounts, so there is nothing to save — and a silent save nobody asked for is a
    // write to the user's file.
    expect(flush).not.toHaveBeenCalled();
    w.unmount();
  });
});
