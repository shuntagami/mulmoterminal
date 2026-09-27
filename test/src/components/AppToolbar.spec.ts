import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AppToolbar from "../../../src/components/AppToolbar.vue";
import { router } from "../../../src/router/index";
import { setToolbarPins } from "../../../src/composables/toolbarPins";
import { holdCollectionChat, resetCollectionChats } from "../../../src/composables/collectionChatSessions";
import { collectionChatKey } from "../../../src/composables/collectionChatKey";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";
import type { Shortcut } from "../../../common/shortcuts";
import { closeCommandPalette, paletteOpen } from "../../../src/composables/commandPalette";
import { useAppConfig } from "../../../src/composables/useAppConfig";
import { setWorklogEnabled } from "../../../src/composables/worklog";
import { roomsExist } from "../../../src/composables/useRooms";

// The pinned favourites the toolbar draws from (#1984). Stubbed rather than fetched: the real store
// loads them over /api/shortcuts, which is a request every mount in this file would otherwise make.
const pinned = vi.hoisted((): { current: Shortcut[] } => ({ current: [] }));
vi.mock("../../../src/composables/useShortcuts", async () => {
  const { computed } = await import("vue");
  return { useShortcuts: () => ({ shortcuts: computed(() => pinned.current) }) };
});

// The toolbar asks the server whether any room exists; here the tests say so themselves.
vi.mock("../../../src/composables/useRooms", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/composables/useRooms")>();
  return { ...original, listRooms: async () => [] };
});

const settle = () => flushPromises();

type Wrapper = ReturnType<typeof mount>;
const mountAt = async (path: string, props: Record<string, unknown> = {}) => {
  await router.push(path);
  await settle();
  const wrapper = mount(AppToolbar, { props, global: { plugins: [router], stubs: { NotificationBell: true, RemoteHostStatus: true } } });
  await settle();
  return wrapper;
};

const screensOf = (wrapper: Wrapper): string[] => wrapper.findAll("[data-testid='toolbar-screens'] button").map((b) => b.attributes("data-testid") ?? "");
const currentScreen = (wrapper: Wrapper): string | undefined => wrapper.find("[data-testid='toolbar-screens'] [aria-current='page']").attributes("data-testid");
const currentSection = (wrapper: Wrapper): string | undefined =>
  wrapper.find("[data-testid='toolbar-sections'] [aria-current='page']").attributes("data-testid");

const resetAvailability = () => {
  useAppConfig().prRepos.value = [];
  setWorklogEnabled(false);
  roomsExist.value = false;
};

beforeEach(async () => {
  resetAvailability();
  await router.push("/terminals");
  await settle();
});
afterEach(resetAvailability);

describe("AppToolbar — two tiers", () => {
  // The top tier picks the section; which one is lit follows the route, never a click held in state.
  it.each([
    ["/terminals", "section-terminal"],
    ["/github", "section-terminal"],
    ["/rooms", "section-terminal"],
    ["/blueprints", "section-terminal"],
    ["/wiki?tag=worklog", "section-terminal"],
    ["/collections", "section-workspace"],
    ["/feeds", "section-workspace"],
    ["/wiki", "section-workspace"],
    ["/accounting", "section-workspace"],
    ["/files", "section-workspace"],
  ])("lights the section %s belongs to", async (path, section) => {
    expect(currentSection(await mountAt(path))).toBe(section);
  });

  it("lights the screen you are on, in the tier below", async () => {
    expect(currentScreen(await mountAt("/terminals"))).toBe("screen-grid");
    expect(currentScreen(await mountAt("/wiki?tag=worklog"))).toBe("screen-worklog");
    expect(currentScreen(await mountAt("/wiki"))).toBe("screen-wiki");
  });

  it("offers the workspace's five screens inside the workspace", async () => {
    expect(screensOf(await mountAt("/collections"))).toEqual(["screen-collections", "screen-feeds", "screen-wiki", "screen-accounting", "screen-files"]);
  });

  it("moves to the first screen of a section from its tab", async () => {
    const wrapper = await mountAt("/terminals");
    await wrapper.get("[data-testid='section-workspace']").trigger("click");
    await settle();
    expect(router.currentRoute.value.path).toBe("/collections");
    await wrapper.get("[data-testid='section-terminal']").trigger("click");
    await settle();
    expect(router.currentRoute.value.path).toBe("/terminals");
  });
});

// A tab only for what is set up: each of these opens onto an empty screen otherwise.
describe("AppToolbar — terminal screens follow what is set up", () => {
  it("offers only the grid and blueprints when nothing is set up", async () => {
    expect(screensOf(await mountAt("/terminals"))).toEqual(["screen-grid", "screen-blueprints"]);
  });

  it("offers PRs once a repository is configured, Rooms once one exists, the worklog while it is on", async () => {
    useAppConfig().prRepos.value = ["receptron/mulmoterminal"];
    roomsExist.value = true;
    setWorklogEnabled(true);
    expect(screensOf(await mountAt("/terminals"))).toEqual(["screen-grid", "screen-github", "screen-rooms", "screen-worklog", "screen-blueprints"]);
  });

  // A direct link must never leave nothing lit.
  it("keeps the screen you are on even when it has nothing set up", async () => {
    const wrapper = await mountAt("/rooms");
    expect(screensOf(wrapper)).toContain("screen-rooms");
    expect(currentScreen(wrapper)).toBe("screen-rooms");
  });
});

describe("AppToolbar — new terminal", () => {
  it("leads the terminal section and is absent from the workspace", async () => {
    expect((await mountAt("/terminals")).find("[data-testid='toolbar-new-terminal']").exists()).toBe(true);
    expect((await mountAt("/collections")).find("[data-testid='toolbar-new-terminal']").exists()).toBe(false);
  });

  it("asks for a new terminal from the grid", async () => {
    const wrapper = await mountAt("/terminals");
    await wrapper.get("[data-testid='toolbar-new-terminal']").trigger("click");
    await settle();
    expect(wrapper.emitted("add-terminal")).toHaveLength(1);
  });

  // A terminal lands in the grid, so another screen of the section brings the grid back first.
  it("brings the grid back first from another screen", async () => {
    const wrapper = await mountAt("/blueprints");
    await wrapper.get("[data-testid='toolbar-new-terminal']").trigger("click");
    await settle();
    expect(router.currentRoute.value.path).toBe("/terminals");
    expect(wrapper.emitted("add-terminal")).toHaveLength(1);
  });
});

describe("AppToolbar — the grid's own controls", () => {
  it("shows the order menu on the grid and nowhere else", async () => {
    expect((await mountAt("/terminals")).find("[data-testid='sort-mode']").exists()).toBe(true);
    expect((await mountAt("/blueprints")).find("[data-testid='sort-mode']").exists()).toBe(false);
  });

  // The menu says which order is in effect instead of cycling through three on each press.
  it("names the order in effect, and picks one by name", async () => {
    const wrapper = await mountAt("/terminals", { sortMode: "manual" });
    const trigger = wrapper.get("[data-testid='sort-mode']");
    expect(trigger.text()).toContain("Manual");
    await trigger.trigger("click");
    const options = wrapper.findAll("[data-testid='sort-mode-option']");
    expect(options.map((o) => o.attributes("aria-checked"))).toEqual(["false", "true", "false"]);
    await options[2].trigger("click");
    expect(wrapper.emitted("set-sort-mode")).toEqual([["priority"]]);
  });

  it("offers the list / thumbnails switch only while a cell is enlarged", async () => {
    expect((await mountAt("/terminals")).find("[data-testid='toolbar-view']").exists()).toBe(false);
    const zoomed = await mountAt("/terminals", { zoomed: true, listMode: true });
    const buttons = zoomed.findAll("[data-testid='toolbar-view'] button");
    expect(buttons.map((b) => b.attributes("aria-pressed"))).toEqual(["true", "false"]);
    await buttons[1].trigger("click");
    expect(zoomed.emitted("set-list-mode")).toEqual([[false]]);
  });

  it("shows the pages only when there is more than one and nothing is enlarged", async () => {
    expect((await mountAt("/terminals", { pages: 1 })).find("[data-testid='toolbar-pages']").exists()).toBe(false);
    expect((await mountAt("/terminals", { pages: 3, zoomed: true })).find("[data-testid='toolbar-pages']").exists()).toBe(false);
    const paged = await mountAt("/terminals", { pages: 3, page: 1 });
    const pages = paged.findAll("[data-testid='toolbar-pages'] button");
    expect(pages.map((b) => b.attributes("aria-pressed"))).toEqual(["false", "true", "false"]);
    await pages[2].trigger("click");
    expect(paged.emitted("switch-page")).toEqual([[2]]);
  });
});

describe("AppToolbar — status strip", () => {
  // In words: three coloured dots with bare numbers made everyone hover to learn which was which.
  it("says what each count is", async () => {
    const wrapper = await mountAt("/terminals", { statusCounts: { blocked: 1, done: 2, working: 3, idle: 0 } });
    const text = wrapper.get("[data-testid='toolbar-status']").text();
    expect(text).toContain("waiting 1");
    expect(text).toContain("running 3");
    expect(text).toContain("done 2");
  });

  // It is the one thing a person reading the wiki still needs to know about the terminals.
  it("stays on screen away from the grid", async () => {
    const wrapper = await mountAt("/wiki", { statusCounts: { blocked: 1, done: 0, working: 0, idle: 0 } });
    expect(wrapper.get("[data-testid='toolbar-status']").text()).toContain("waiting 1");
  });
});

describe("AppToolbar — collection chat badge", () => {
  const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
  const chat = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });

  beforeEach(resetCollectionChats);
  afterEach(resetCollectionChats);

  it("wears nothing while no chat is running there", async () => {
    const wrapper = await mountAt("/terminals");
    expect(wrapper.find("[data-testid='workspace-chat-count']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='section-workspace']").attributes("aria-label")).toBe("Workspace");
  });

  // On the section it belongs to, which is on screen from anywhere.
  it("counts the chats filed under collections, and says so in the name", async () => {
    holdCollectionChat(works, chat("a"));
    holdCollectionChat(works, chat("b"));
    const wrapper = await mountAt("/terminals");
    expect(wrapper.get("[data-testid='workspace-chat-count']").text()).toBe("2");
    expect(wrapper.get("[data-testid='section-workspace']").attributes("aria-label")).toBe("Workspace — 2 chats open here");
  });
});

// #1984: a few pinned collections get a permanent button, so opening one is a single press.
describe("AppToolbar — pinned collections", () => {
  const works: Shortcut = { kind: "collection", slug: "works", title: "Work log", icon: "task" };
  const news: Shortcut = { kind: "feed", slug: "news", title: "News", icon: "rss_feed" };
  const pinGroup = (wrapper: Wrapper) => wrapper.find("[role='group'][aria-label='Pinned collections and feeds']");

  beforeEach(() => {
    pinned.current = [works, news];
    setToolbarPins([]);
  });
  afterEach(() => {
    pinned.current = [];
    setToolbarPins([]);
  });

  it("draws nothing at all while none is promoted", async () => {
    expect(pinGroup(await mountAt("/terminals")).exists()).toBe(false);
  });

  it("offers the promoted ones, in the configured order", async () => {
    setToolbarPins(["feed:news", "collection:works"]);
    const group = pinGroup(await mountAt("/terminals"));
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["News", "Work log"]);
  });

  // A shortcut across sections, so it stays on the tier that never changes.
  it.each(["/terminals", "/collections", "/wiki"])("keeps them on %s", async (path) => {
    setToolbarPins(["collection:works"]);
    expect(pinGroup(await mountAt(path)).exists()).toBe(true);
  });

  it("opens the collection in one press", async () => {
    setToolbarPins(["collection:works"]);
    const wrapper = await mountAt("/terminals");
    await pinGroup(wrapper).findAll("button")[0].trigger("click");
    await settle();
    expect(router.currentRoute.value.path).toBe("/collections/works");
  });

  it("lights the one you are looking at", async () => {
    setToolbarPins(["collection:works", "feed:news"]);
    const lit = pinGroup(await mountAt("/collections/works"))
      .findAll("button")
      .filter((b) => b.classes().includes("bg-accent-bg"))
      .map((b) => b.attributes("aria-label"));
    expect(lit).toEqual(["Work log"]);
  });

  it("skips a promoted key whose pin is gone", async () => {
    setToolbarPins(["collection:works", "collection:deleted"]);
    const group = pinGroup(await mountAt("/terminals"));
    expect(group.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Work log"]);
  });
});

// #2266. The palette is reachable with no key bound: the toolbar has a button for it.
describe("AppToolbar — command palette", () => {
  it("opens the command palette from its button", async () => {
    const wrapper = await mountAt("/terminals");
    await wrapper.get("[data-testid='toolbar-commands']").trigger("click");
    await flushPromises();
    expect(paletteOpen.value).toBe(true);
    expect(document.querySelector('[data-testid="command-palette"]')).not.toBeNull();
    closeCommandPalette();
    wrapper.unmount();
  });
});
