<script setup lang="ts">
// One file panel: the user's page in a frame, and the wire to it (common/filePanels.ts).
//
// This component is the whole of what a page can do to the app. It can be told about the open
// file, and it can ask for five things — be shown, mark lines, move the editor, question its own
// command, put text at the terminal's prompt. Each arrives here as a message, is read as untrusted,
// and leaves as an emit the pane decides about. Nothing the page sends is ever evaluated or drawn.
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { readFilePanelPageMessage, type FilePanel, type FilePanelHostMessage, type PanelFile, type PanelMark } from "../../common/filePanels";
import type { PreviewTheme } from "../../common/previewTheme";
import { listenToPreviewFrame } from "../utils/sharedAppPreviewChannel";
import { postToFilePanel } from "../utils/filePanelFrame";

export type PanelRequestOutcome = { ok: true; result: unknown } | { ok: false; error: string };

const props = defineProps<{
  panel: FilePanel;
  /** The open file, without its text — that is read when it is sent. */
  file: Omit<PanelFile, "content">;
  /** Moves when the file on disk does. The page is told again, and keeps its marks meanwhile. */
  diskVersion: string | null;
  content: () => string;
  theme: PreviewTheme | null;
  /** Where this panel's marks are now. */
  markLines: Record<string, number>;
  /** The mark of this panel that was last clicked; a new object for every click. */
  clicked: { id: string } | null;
  request: (payload: unknown) => Promise<PanelRequestOutcome>;
}>();
const emit = defineEmits<{ visible: [visible: boolean]; marks: [marks: PanelMark[]]; reveal: [line: number]; insert: [text: string] }>();

const frame = useTemplateRef<HTMLIFrameElement>("frame");
// Whether the page has said it is listening. Until then nothing is sent: a message posted into a
// frame that is still loading is delivered to nobody.
const ready = ref(false);
let sent = 0;
const post = (message: FilePanelHostMessage): void => postToFilePanel(frame.value, message);

function sendFile(): void {
  if (!ready.value) return;
  sent += 1;
  post({ kind: "file", version: sent, file: { ...props.file, content: props.content() }, theme: props.theme });
}

async function answer(requestId: string, payload: unknown): Promise<void> {
  const outcome = await props.request(payload);
  post(outcome.ok ? { kind: "response", requestId, ok: true, result: outcome.result } : { kind: "response", requestId, ok: false, error: outcome.error });
}

function receive(data: unknown): void {
  const message = readFilePanelPageMessage(data);
  if (!message) return;
  if (message.kind === "ready") {
    ready.value = true;
    sendFile();
  } else if (message.kind === "show") emit("visible", message.visible);
  else if (message.kind === "marks") emit("marks", message.marks);
  else if (message.kind === "reveal") emit("reveal", message.line);
  else if (message.kind === "insert") emit("insert", message.text);
  else void answer(message.requestId, message.payload);
}

// Another file: what the page said about the last one — its marks, that it wanted room — is about
// text that is no longer on screen. Cleared here, before the page hears of the new file, so a slow
// page cannot leave the old file's marks on the new one.
watch(
  () => props.file.path,
  () => {
    emit("marks", []);
    emit("visible", false);
    sendFile();
  },
);
watch([() => props.diskVersion, () => props.file.reference, () => props.theme], sendFile);
watch(
  () => props.markLines,
  (lines) => {
    if (ready.value && Object.keys(lines).length > 0) post({ kind: "mark-lines", lines });
  },
);
watch(
  () => props.clicked,
  (clicked) => {
    if (clicked && ready.value) post({ kind: "mark-clicked", id: clicked.id });
  },
);

let stopListening = (): void => {};
onMounted(() => {
  stopListening = listenToPreviewFrame(() => frame.value, receive);
});
onBeforeUnmount(() => {
  stopListening();
  emit("marks", []);
});
</script>

<template>
  <!-- `allow-scripts` and deliberately NOT `allow-same-origin`: the page is somebody's own code, and
       opaque-origin is what keeps it out of this app's storage and its `/api`. The server sends the
       same sandbox as a header, so the two cannot disagree. -->
  <iframe
    ref="frame"
    :data-testid="`file-panel-${panel.id}`"
    class="min-h-0 w-full flex-auto border-0 bg-[var(--bg-base)]"
    :src="`/api/files/panel/${encodeURIComponent(panel.id)}/page`"
    sandbox="allow-scripts"
    :title="panel.label"
  />
</template>
