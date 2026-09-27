<script setup lang="ts">
// How the grid orders its cells, as a menu that SAYS which order is in effect.
//
// It replaces a button that cycled through three states on each press, drawn as an icon whose
// only difference between "manual" and the others was a highlight. Nobody could tell which order
// they were in without hovering, and reaching the third mode meant pressing past the second.
import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import type { SortMode } from "./gridTabs";

const props = defineProps<{ mode: SortMode }>();
const emit = defineEmits<{ (e: "select", mode: SortMode): void }>();
const { t } = useI18n();

// Attention first leads: it is the default a new grid starts in, and the one most people want.
const MODES: readonly SortMode[] = ["auto", "manual", "priority"];

const root = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(root);
const current = computed(() => t(`toolbar.sort.modes.${props.mode}`));

function pick(mode: SortMode): void {
  close();
  if (mode !== props.mode) emit("select", mode);
}
</script>

<template>
  <div ref="root" class="relative flex-none">
    <button
      type="button"
      data-testid="sort-mode"
      class="inline-flex h-[26px] cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-md border border-border pl-2.5 pr-1 font-sans text-[12px] text-fg hover:bg-hover"
      :class="open ? 'bg-selected' : 'bg-panel'"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      {{ t("toolbar.sort.label", { mode: current }) }}
      <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">arrow_drop_down</span>
    </button>
    <div
      v-if="open"
      role="menu"
      :aria-label="t('toolbar.sort.menu')"
      class="absolute right-0 top-full z-60 mt-1 w-[280px] rounded-lg border border-border bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
    >
      <button
        v-for="m in MODES"
        :key="m"
        type="button"
        role="menuitemradio"
        data-testid="sort-mode-option"
        class="flex w-full cursor-pointer items-start gap-2.5 rounded border-0 bg-transparent px-2.5 py-[7px] text-left font-sans text-[13px] text-fg hover:bg-hover"
        :aria-checked="m === mode"
        @click="pick(m)"
      >
        <span class="material-symbols-outlined text-[18px] leading-none text-accent" :class="m === mode ? 'visible' : 'invisible'" aria-hidden="true"
          >check</span
        >
        <span class="flex flex-col gap-0.5">
          <span>{{ t(`toolbar.sort.modes.${m}`) }}</span>
          <span class="text-[11px] text-dim">{{ t(`toolbar.sort.help.${m}`) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
