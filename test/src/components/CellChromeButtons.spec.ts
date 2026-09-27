import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { cellChromeBinding } from "../../../src/components/cellChromeBinding";
import { CELL_BTN, CELL_CLOSE_BTN } from "../../../src/components/cellChromeClasses";
import { RIGHT_PANES, type RightPane } from "../../../src/components/gridCell";

const mountButtons = (expanded = false) => mount(CellChromeButtons, { props: { expanded } });
const PANEL = '[data-testid="cell-panel-btn"]';

describe("CellChromeButtons", () => {
  // Both buttons must carry their styling as utilities. As scoped CSS it reached neither: this
  // component's template has a fragment root, and Vue gives the parent cell's scope id to a
  // single root element only — so both rendered with the browser's default button chrome while
  // the buttons in the cell's own template did not (#787, #791).
  it("styles both buttons with utilities rather than a stylesheet", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toEqual(expect.arrayContaining(CELL_BTN.split(" ")));
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(CELL_CLOSE_BTN.split(" ")));
  });

  // The close button's red hover is the whole reason it isn't just CELL_BTN.
  it("gives the close button its own hover colours", () => {
    expect(mountButtons().find('[aria-label="Close terminal"]').classes()).not.toContain("hover:bg-hover");
  });

  it("keeps the cell-btn / cell-close hooks the grid and the specs select on", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toContain("cell-btn");
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(["cell-btn", "cell-close"]));
  });

  // Found by its label rather than as the first `.cell-btn`: while enlarged the Panel button leads
  // the row, so "the first button" is no longer expand/restore.
  it("offers expand while tiled and restore while expanded", () => {
    expect(mountButtons(false).find('[aria-label="Expand terminal"]').text()).toBe("open_in_full");
    const restore = mountButtons(true).find('[aria-label="Restore terminal"]');
    expect(restore.exists()).toBe(true);
    expect(restore.text()).toBe("close_fullscreen");
    expect(restore.attributes("title")).toBe("Restore");
    expect(mountButtons(true).find('[aria-label="Expand terminal"]').exists()).toBe(false);
  });

  it("emits toggle-expand and close from their own buttons", async () => {
    const w = mountButtons();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });

  // The collection pane wins over the zoom (it is an overlay on top of the grid), so enlarging
  // from there sets a state nobody can see until they leave — a control that looks broken (#2001).
  it("drops the expand button where enlarging would do nothing visible", () => {
    const w = mount(CellChromeButtons, { props: { expanded: false, hideExpand: true } });
    expect(w.find('[aria-label="Expand terminal"]').exists()).toBe(false);
    expect(w.find('[aria-label="Close terminal"]').exists()).toBe(true); // and nothing else goes
  });

  // The flag is negative because Vue casts an absent boolean prop to `false` at every level it
  // passes through — a positive "expandable" was hidden for every caller that never mentions it,
  // which is most of them.
  it("keeps the expand button for a caller that says nothing", () => {
    expect(mountButtons().find('[aria-label="Expand terminal"]').exists()).toBe(true);
    expect(
      mount(CellChromeButtons, { props: { expanded: false, hideExpand: false } })
        .find('[aria-label="Expand terminal"]')
        .exists(),
    ).toBe(true);
  });
});

// ONE button for the side pane. There used to be a toggle per pane — files, canvas, tools,
// prompts, conversation, collections, GitHub — for one slot that only ever holds one of them, and
// seven icons read as seven independent switches. Which pane shows is now chosen by the tabs
// inside the pane, so all the header has to say is whether the pane is there.
describe("the Panel button", () => {
  const panel = (props: Record<string, unknown>) => mount(CellChromeButtons, { props: { expanded: true, ...props } }).find(PANEL);

  // The pane splits the ENLARGED cell's room, so its toggle only exists there — a tiled cell or a
  // filmstrip thumbnail has nowhere to put it.
  it("is absent until the cell is enlarged", () => {
    expect(mountButtons(false).find(PANEL).exists()).toBe(false);
    expect(mountButtons(true).find(PANEL).exists()).toBe(true);
  });

  // A sidebar glyph says nothing about what is in the sidebar, so the button carries a word too.
  it("says what it is in words, not by its icon alone", () => {
    expect(panel({}).text()).toContain("Panel");
  });

  it("reads as pressed, and renames itself, while the pane is open", () => {
    const open = panel({ panelOpen: true });
    expect(open.attributes("aria-pressed")).toBe("true");
    expect(open.attributes("title")).toBe("Hide the side panel");

    const closed = panel({});
    expect(closed.attributes("aria-pressed")).toBe("false");
    expect(closed.attributes("title")).toBe("Show the side panel");
  });

  it("emits the intent and never acts on it, like its neighbours", async () => {
    const w = mountButtons(true);
    await w.find(PANEL).trigger("click");
    expect(w.emitted("toggle-panel")).toHaveLength(1);
    expect(w.emitted("toggle-expand")).toBeUndefined();
    expect(w.emitted("close")).toBeUndefined();
  });

  // Whichever pane the grid has open, this is the header's way to put it away — so it must read
  // as pressed for EVERY occupant of the slot, not just the ones that happened to have a button
  // before. Derived from RIGHT_PANES through the real binding, so a pane added there is covered
  // the day it lands rather than the day someone remembers to list it here.
  it("reads as pressed for every pane the slot can hold, and for none when it is empty", () => {
    const pressedFor = (rightPane: RightPane | null | undefined) =>
      panel({ ...cellChromeBinding({ expanded: true, rightPane }, () => {}).chromeProps.value }).attributes("aria-pressed");
    for (const pane of RIGHT_PANES) expect(pressedFor(pane), pane).toBe("true");
    expect(pressedFor(null)).toBe("false");
    expect(pressedFor(undefined)).toBe("false");
  });

  // The cell's ⋮ menu goes where the cell puts it — between the pane and the window controls — so
  // expand/restore and close keep the far end of the row, in the same place on every cell whether
  // it has a menu or not. Close last: the one that tears a session down sits past everything
  // reversible.
  it("leads the row, with the cell's own menu next and expand/restore and close at the end", () => {
    const labels = (expanded: boolean) =>
      mount(CellChromeButtons, {
        props: { expanded },
        slots: { default: '<button class="cell-btn" aria-label="More actions">more_vert</button>' },
      })
        .findAll("button")
        .map((b) => b.attributes("data-testid") ?? b.attributes("aria-label"));
    expect(labels(true)).toEqual(["cell-panel-btn", "More actions", "Restore terminal", "Close terminal"]);
    expect(labels(false)).toEqual(["More actions", "Expand terminal", "Close terminal"]);
  });
});

// Which pane is open used to be carried only by `aria-pressed` and the tooltip — read by a screen
// reader, and by whoever happens to hover — while the button looked identical to anyone just
// looking at it. Idle chrome differs from hover by a background alone, which says nothing once
// the cursor is elsewhere.
describe("the Panel button, seen", () => {
  const header = (props: Record<string, unknown>) => mount(CellChromeButtons, { props: { expanded: true, ...props } });
  const isMarked = (classes: string[]) => classes.includes("bg-selected") && classes.includes("text-accent");

  it("fills and recolours itself while the pane is open", () => {
    expect(isMarked(header({ panelOpen: true }).find(PANEL).classes())).toBe(true);
    expect(isMarked(header({ panelOpen: false }).find(PANEL).classes())).toBe(false);
  });

  // Nothing else in the chrome is a pane, so nothing else may read as the open one — a second
  // marked button would leave the user guessing which control the pane belongs to.
  it("is the only button marked, and none is when the pane is closed", () => {
    const marked = (panelOpen: boolean) =>
      header({ panelOpen })
        .findAll("button")
        .filter((b) => isMarked(b.classes()));
    expect(marked(true)).toHaveLength(1);
    expect(marked(true)[0].attributes("data-testid")).toBe("cell-panel-btn");
    expect(marked(false)).toHaveLength(0);
  });

  // Appending the pressed classes would leave `bg-transparent` on the element too, and which of
  // two competing utilities wins is Tailwind's output order rather than the order written here.
  it("swaps the idle fill out rather than layering over it", () => {
    expect(header({ panelOpen: true }).find(PANEL).classes()).not.toContain("bg-transparent");
    expect(header({ panelOpen: false }).find(PANEL).classes()).toContain("bg-transparent");
  });
});
