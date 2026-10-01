<script setup lang="ts">
// Shown over the editor when a save lost the version race: the file changed on disk, nothing was
// written, and the reader chooses which side wins. Its own component only so the pane stays under
// its size limit — the two ways out are the pane's, and it is told which was picked.
const emit = defineEmits<{ reload: []; overwrite: [] }>();
const BUTTON = "h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg";
</script>

<template>
  <div
    role="alert"
    data-testid="files-conflict"
    class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-amber bg-[var(--warn-bg-subtle)] px-4 py-2 text-[13px] text-warn"
  >
    <span class="material-symbols-outlined" aria-hidden="true">warning</span>
    <span class="flex-auto">This file changed on disk. Nothing was saved — your version is kept as a backup either way.</span>
    <button type="button" :class="BUTTON" @click="emit('reload')">Reload (discard your edits)</button>
    <button type="button" :class="BUTTON" @click="emit('overwrite')">Overwrite anyway</button>
  </div>
</template>
