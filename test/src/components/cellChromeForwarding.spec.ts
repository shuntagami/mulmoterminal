import { describe, it, expect, vi } from "vitest";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { cellChromeBinding, cellShellEvents, type CellChromeEvent } from "../../../src/components/cellChromeBinding";

// A cell binds the chrome buttons with ONE object (`v-on="chromeEvents"`), so an event the
// buttons can raise but that object has no key for is dropped where nothing can see it: the
// button clicks, the grid's handler waits for something that never arrives, and typecheck is
// happy because an unlistened emit is legal Vue.
//
// That is not hypothetical. The collections button shipped in #1573 emitting `toggle-collections`
// while `cellChromeBinding` mapped four events and `GridCellEmits` declared five — so "Show this
// folder's collections" never once opened the pane, through a green suite that included a
// "forwards every chrome event" test whose list was TYPED BY HAND from the same wrong set.
//
// Hence: the expectation is DERIVED from the component's own declared emits. A new button is
// covered the day it is added, and a hand-maintained list cannot agree with itself into a
// second silent dead button.
const declaredEmits = (CellChromeButtons as unknown as { emits?: string[] }).emits ?? [];

// Every event the buttons raise goes through the shared object: none is bound by a cell itself.
// Setting a terminal aside used to be the exception (`toggle-park`, wired beside the object on
// TerminalCell alone); it is an item in that cell's own ⋮ menu now, which the chrome only hosts
// in its slot and whose events are the cell's, not the chrome's.

describe("cellChromeBinding forwards every event the chrome buttons can raise", () => {
  it("declares emits at runtime, so this spec is comparing against something real", () => {
    // Guards the derivation itself: if the SFC compiler stopped emitting the array, every
    // assertion below would pass vacuously against an empty list.
    expect(declaredEmits).toContain("toggle-panel");
    expect(declaredEmits.length).toBeGreaterThanOrEqual(3);
  });

  it("maps each one in chromeEvents — the binding TerminalCell and CellShell use", () => {
    const { chromeEvents } = cellChromeBinding({ expanded: true }, () => {});
    expect(new Set(Object.keys(chromeEvents))).toEqual(new Set(declaredEmits));
  });

  it("maps each one in cellShellEvents — the binding the command and launcher cells use", () => {
    // Exactly the chrome's set, with nothing of the shell's own beside it: the reorder arrows, and
    // the `move` they raised, have left the header.
    expect(new Set(Object.keys(cellShellEvents(() => {})))).toEqual(new Set(declaredEmits));
  });

  it("re-emits each event under its OWN name rather than a near-miss", () => {
    const emit = vi.fn();
    const bindings = [cellChromeBinding({ expanded: true }, emit).chromeEvents, cellShellEvents(emit)];
    for (const events of bindings) {
      for (const [name, handler] of Object.entries(events)) {
        emit.mockClear();
        handler();
        expect(emit).toHaveBeenCalledWith(name as CellChromeEvent);
      }
    }
  });

  it("still routes close through the caller's own handler", () => {
    const emit = vi.fn();
    const close = vi.fn();
    cellChromeBinding({ expanded: true }, emit, close).chromeEvents.close();
    expect(close).toHaveBeenCalledTimes(1);
    // TerminalCell's close confirms before tearing a live session down — it must not ALSO emit.
    expect(emit).not.toHaveBeenCalled();
  });
});
