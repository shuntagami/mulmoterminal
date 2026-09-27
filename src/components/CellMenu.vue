<script setup lang="ts">
// A cell's ⋮ menu: the things done to a cell or its session now and then, named in words.
//
// Before the header redesign each of these was its own permanent icon — the note pencil, set aside,
// talk to another terminal, copy a code block, the activity timeline — beside the ones pressed all
// day, at the same size and weight. None is used often enough to earn that, and several (`outbox`,
// `bedtime`, `history`) could not be read without hovering.
//
// Teleported to <body> and fixed under the trigger, as the roster's menu is: a cell is
// `overflow: hidden`, and a small tile would clip a menu left inside it. A scroll anywhere closes it,
// since the fixed panel would otherwise stay where the trigger used to be.
import { onBeforeUnmount, ref, useTemplateRef } from "vue";
import { CELL_BTN, CELL_BTN_ACTIVE } from "./cellChromeClasses";

export interface CellMenuItem {
  key: string;
  icon: string;
  label: string;
  /** A second, quieter line under the label — what the action promises. */
  detail?: string;
  /** It opens something further rather than acting at once. */
  opens?: boolean;
  run: () => void;
}
export interface CellMenuSection {
  key: string;
  title: string;
  items: CellMenuItem[];
}

defineProps<{ sections: CellMenuSection[] }>();

const trigger = useTemplateRef<HTMLElement>("trigger");
const menu = useTemplateRef<HTMLElement>("menu");
const open = ref(false);
const pos = ref({ top: 0, left: 0 });
const MENU_WIDTH_PX = 260;

function place(): void {
  const rect = trigger.value?.getBoundingClientRect();
  if (rect) pos.value = { top: Math.round(rect.bottom + 4), left: Math.round(Math.max(8, rect.right - MENU_WIDTH_PX)) };
}
function onOutside(event: PointerEvent): void {
  const target = event.target instanceof Node ? event.target : null;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}
function openMenu(): void {
  place();
  open.value = true;
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", close, true);
}
function close(): void {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", close, true);
}
function toggle(): void {
  if (open.value) close();
  else openMenu();
}
function pick(item: CellMenuItem): void {
  close();
  item.run();
}
onBeforeUnmount(close);
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="cell-btn"
    data-testid="cell-menu"
    :class="open ? CELL_BTN_ACTIVE : CELL_BTN"
    title="More"
    aria-label="More actions"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="toggle"
  >
    <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      data-testid="cell-menu-panel"
      role="menu"
      class="fixed z-[60] flex flex-col rounded-lg border border-border bg-panel p-1 font-sans text-fg shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${MENU_WIDTH_PX}px` }"
      @click.stop
    >
      <template v-for="(section, index) in sections" :key="section.key">
        <div v-if="index > 0" class="mx-1.5 my-1 h-px bg-border" aria-hidden="true" />
        <div class="px-2.5 pb-1 pt-1.5 text-[11px] text-dim">{{ section.title }}</div>
        <button
          v-for="item in section.items"
          :key="item.key"
          type="button"
          role="menuitem"
          :data-testid="`cell-menu-${item.key}`"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2.5 py-[7px] text-left text-[13px] text-fg hover:bg-hover"
          @click="pick(item)"
        >
          <span class="material-symbols-outlined flex-none text-[18px] leading-none text-muted" aria-hidden="true">{{ item.icon }}</span>
          <span class="flex min-w-0 flex-auto flex-col gap-px">
            <span>{{ item.label }}</span>
            <span v-if="item.detail" class="text-[11px] text-dim">{{ item.detail }}</span>
          </span>
          <span v-if="item.opens" class="material-symbols-outlined flex-none text-[16px] leading-none text-dim" aria-hidden="true">chevron_right</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
