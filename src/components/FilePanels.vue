<script setup lang="ts">
// The column of file panels beside the editor (common/filePanels.ts). A frame exists for every
// panel that covers the open file, but the column takes room only once a page asks to be shown —
// a panel with nothing to say about this file is loaded, listening, and invisible.
import { computed, reactive } from "vue";
import type { FilePanel, PanelFile, PanelMark } from "../../common/filePanels";
import type { PreviewTheme } from "../../common/previewTheme";
import FilePanelFrame, { type PanelRequestOutcome } from "./FilePanelFrame.vue";

const props = defineProps<{
  panels: readonly FilePanel[];
  file: Omit<PanelFile, "content">;
  diskVersion: string | null;
  content: () => string;
  theme: PreviewTheme | null;
  /** Where every panel's marks are now, by panel id. */
  markLines: Record<string, Record<string, number>>;
  clicked: { panel: string; id: string } | null;
  request: (panel: string, payload: unknown) => Promise<PanelRequestOutcome>;
}>();
const emit = defineEmits<{ marks: [panel: string, marks: PanelMark[]]; reveal: [line: number]; insert: [text: string] }>();

const visible = reactive<Record<string, boolean>>({});
const anyVisible = computed(() => props.panels.some((panel) => visible[panel.id]));
const NO_LINES: Record<string, number> = {};
</script>

<template>
  <aside v-show="anyVisible" data-testid="file-panels" class="flex w-[340px] flex-none flex-col border-l border-border">
    <div
      v-for="panel in panels"
      v-show="visible[panel.id]"
      :key="panel.id"
      class="flex min-h-0 flex-auto basis-0 flex-col border-b border-border last:border-b-0"
    >
      <FilePanelFrame
        v-bind="{ panel, file, diskVersion, content, theme }"
        :mark-lines="markLines[panel.id] ?? NO_LINES"
        :clicked="clicked?.panel === panel.id ? clicked : null"
        :request="(payload) => request(panel.id, payload)"
        @visible="visible[panel.id] = $event"
        @marks="emit('marks', panel.id, $event)"
        @reveal="emit('reveal', $event)"
        @insert="emit('insert', $event)"
      />
    </div>
  </aside>
</template>
