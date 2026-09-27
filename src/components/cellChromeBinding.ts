// The props and listeners every cell hands its CellChromeButtons, built once here instead of
// re-spelled per cell type — the three cell types used to bind them by hand, and a cell type that
// forgot one was a cell that quietly behaved differently from its neighbours.
import { computed, type ComputedRef } from "vue";
import type { RightPane } from "./gridCell";

/** What a cell knows that the chrome reads. */
export interface CellChromeSource {
  expanded: boolean;
  rightPane?: RightPane | null | undefined;
  hideExpand?: boolean | undefined;
}

export interface CellChromeProps {
  expanded: boolean;
  panelOpen: boolean;
  hideExpand: boolean;
}

export type CellChromeEvent = "toggle-expand" | "toggle-panel" | "close";

/** The chrome's props, and a listener per event that forwards it — except `close`, which the caller
 *  may own (TerminalCell confirms before closing a live session). */
export function cellChromeBinding(
  source: CellChromeSource,
  emit: (event: CellChromeEvent) => void,
  close: () => void = () => emit("close"),
): { chromeProps: ComputedRef<CellChromeProps>; chromeEvents: Record<CellChromeEvent, () => void> } {
  return {
    chromeProps: computed(() => ({
      expanded: source.expanded,
      panelOpen: (source.rightPane ?? null) !== null,
      hideExpand: source.hideExpand ?? false,
    })),
    chromeEvents: {
      "toggle-expand": () => emit("toggle-expand"),
      "toggle-panel": () => emit("toggle-panel"),
      close,
    },
  };
}

/** CellShell's own set: the chrome's events, forwarded as they are. */
export function cellShellEvents(emit: (event: CellChromeEvent) => void): Record<CellChromeEvent, () => void> {
  return {
    "toggle-expand": () => emit("toggle-expand"),
    "toggle-panel": () => emit("toggle-panel"),
    close: () => emit("close"),
  };
}
