<script setup lang="ts">
// The buttons every grid cell's header ends with — identical in the command, launcher and terminal
// cells, down to the labels and the glyphs, because they mean the same thing to the grid (#646 B3):
//
//   Panel    — the side pane beside the enlarged cell. ONE button: which pane shows is chosen by the
//              tabs inside it. There used to be a toggle per pane (files, canvas, tools, prompts,
//              conversation, collections, GitHub) — seven icons for one slot that holds one pane,
//              read as seven independent switches.
//   (slot)   — the cell's ⋮ menu, from the cells that have one.
//   Expand / Restore, Close.
//
// What "close" DOES stays with the parent: TerminalCell's may hold a live session, so its handler
// confirms before tearing down. This emits the intent and never acts on it (#826).
//
// No `.stop` on the clicks: the enclosing header's zoom gesture already ignores anything inside a
// button (shouldZoomOnHeaderClick), and stopping here would only hide that.
import { CELL_BTN, CELL_BTN_ACTIVE, CELL_CLOSE_BTN } from "./cellChromeClasses";

defineProps<{
  expanded: boolean;
  // Whether this cell has a side pane open — the Panel button's pressed state.
  panelOpen?: boolean;
  // Drop the expand button, because enlarging would do nothing anyone can SEE. True only in the
  // collection pane, which is an overlay on top of the grid and wins over the zoom underneath it.
  //
  // Stated negatively on purpose: Vue casts an absent boolean prop to `false` at EVERY level it
  // passes through, so a positive "expandable" would have to survive that in each one (#2001).
  hideExpand?: boolean;
}>();
const emit = defineEmits<{ (e: "toggle-expand" | "toggle-panel" | "close"): void }>();
</script>

<template>
  <!-- Only while enlarged: the pane splits the enlarged cell's room, which a tile or a filmstrip
       thumbnail does not have. Labelled, not an icon alone — a sidebar glyph says nothing about
       what is in the sidebar. -->
  <button
    v-if="expanded"
    type="button"
    data-testid="cell-panel-btn"
    class="cell-btn !w-auto gap-1 px-1.5 font-sans text-[12px]"
    :class="panelOpen ? CELL_BTN_ACTIVE : CELL_BTN"
    :aria-pressed="!!panelOpen"
    :title="panelOpen ? 'Hide the side panel' : 'Show the side panel'"
    @click="emit('toggle-panel')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">view_sidebar</span>Panel
  </button>
  <slot />
  <button
    v-if="!hideExpand"
    type="button"
    class="cell-btn"
    :class="CELL_BTN"
    :title="expanded ? 'Restore' : 'Expand'"
    :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
    @click="emit('toggle-expand')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
  </button>
  <button type="button" class="cell-btn cell-close" :class="CELL_CLOSE_BTN" title="Close terminal" aria-label="Close terminal" @click="emit('close')">
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</template>
