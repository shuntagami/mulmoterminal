<script setup lang="ts">
// The drag handle at the head of a tile's header: the one way to reorder cells by pointer, in the
// tiled grid as in the roster, whatever the order mode (dragging makes the order manual). It replaced
// the step-wise Move left / Move right arrows every cell used to carry.
//
// A span rather than a button, and aria-hidden: a drag is not a keyboard gesture, and the command
// palette's "Move this terminal earlier / later" is the accessible route to the same reorder.
// `@click.stop` keeps a press that never became a drag from enlarging the cell, which is what a
// click on the header background does.
const emit = defineEmits<{ (e: "pick", event: DragEvent): void; (e: "end"): void }>();
</script>

<template>
  <span
    data-testid="cell-drag"
    class="material-symbols-outlined flex-none cursor-grab text-[16px] leading-none text-[var(--cell-header-fg,var(--text-dim))] opacity-60 hover:opacity-100 active:cursor-grabbing"
    draggable="true"
    aria-hidden="true"
    title="Drag to reorder"
    @click.stop
    @dragstart="emit('pick', $event)"
    @dragend="emit('end')"
    >drag_indicator</span
  >
</template>
