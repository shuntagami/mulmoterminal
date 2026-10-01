<script setup lang="ts">
// The open file's comments, beside the editor (common/fileAnnotations.ts): each thread with the
// passage it is about, its replies, a place to answer, and — where there is a terminal beside the
// pane — a way to hand it to the agent there.
//
// Beside the EDITOR only. The Preview is a different document with no lines to hang a comment on,
// so the pane shows this while the source is on screen and not otherwise.
import { nextTick, reactive, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AnnotationComment } from "../../common/fileAnnotations";
import type { ShownThread } from "../composables/useFileAnnotations";

const props = defineProps<{
  threads: readonly ShownThread[];
  failures: readonly { label: string; error: string }[];
  activeKey: string | null;
  busyKey: string | null;
  actionError: string | null;
  /** Whether there is a terminal beside the pane to put a request in. */
  canAsk: boolean;
  /** The line a thread is on now — the editor's, which the reader's typing moves. */
  lineOf: (thread: ShownThread) => number | null;
  /** Function props rather than emits for these two: the panel has to know whether a reply landed
   *  before it clears what was typed. */
  reply: (key: string, body: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ reveal: [key: string]; resolve: [key: string]; ask: [keys: string[]]; refresh: [] }>();
const { t, locale } = useI18n();

// What is being typed, per thread. Kept across a re-read of the comments — the file is re-read
// whenever the agent beside it saves, and that must not eat a half-written reply.
const drafts = reactive<Record<string, string>>({});

async function send(key: string): Promise<void> {
  const body = drafts[key] ?? "";
  if (await props.reply(key, body)) drafts[key] = "";
}

function onReplyKey(e: KeyboardEvent, key: string): void {
  // Cmd/Ctrl+Enter sends; a bare Enter is a line break, because a reply to a client is prose.
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void send(key);
  }
}

function where(thread: ShownThread): string {
  const line = props.lineOf(thread);
  if (line === null) return t("fileAnnotations.unplaced");
  const span = thread.line !== null && thread.endLine !== null ? thread.endLine - thread.line : 0;
  const lines = span > 0 ? t("fileAnnotations.lines", { from: line, to: line + span }) : t("fileAnnotations.line", { line });
  if (thread.placement === "moved") return `${lines} · ${t("fileAnnotations.moved")}`;
  return thread.placement === "estimated" ? `${lines} · ${t("fileAnnotations.estimated")}` : lines;
}

/** A provider's time in the reader's locale, or its own text when it is not a time at all. */
function when(comment: AnnotationComment): string {
  if (!comment.createdAt) return "";
  const at = new Date(comment.createdAt);
  return Number.isNaN(at.getTime()) ? comment.createdAt : at.toLocaleString(locale.value, { dateStyle: "short", timeStyle: "short" });
}

// A mark clicked in the gutter brings its thread into view here.
const listEl = useTemplateRef<HTMLElement>("listEl");
watch(
  () => props.activeKey,
  async (key) => {
    if (!key) return;
    await nextTick();
    [...(listEl.value?.querySelectorAll<HTMLElement>("[data-thread]") ?? [])].find((el) => el.dataset.thread === key)?.scrollIntoView({ block: "nearest" });
  },
);

const BUTTON =
  "h-[24px] cursor-pointer rounded-md border border-border bg-base px-2 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50";
</script>

<template>
  <aside
    data-testid="file-annotations"
    class="flex w-[320px] flex-none flex-col border-l border-border bg-panel font-sans text-[13px]"
    :aria-label="t('fileAnnotations.title')"
  >
    <header class="flex flex-none items-center gap-2 border-b border-border px-3 py-1.5">
      <span class="material-symbols-outlined text-amber" aria-hidden="true">comment</span>
      <span class="flex-auto text-fg">{{ t("fileAnnotations.title") }}</span>
      <span class="text-[12px] text-muted">{{ t("fileAnnotations.count", { count: threads.length }) }}</span>
      <button
        v-if="canAsk && threads.length > 1"
        type="button"
        data-testid="file-annotations-ask-all"
        :class="BUTTON"
        :data-tip="t('fileAnnotations.askTip')"
        @click="
          emit(
            'ask',
            threads.map((thread) => thread.key),
          )
        "
      >
        {{ t("fileAnnotations.askAll") }}
      </button>
      <button
        type="button"
        data-testid="file-annotations-refresh"
        :class="BUTTON"
        :data-tip="t('fileAnnotations.refresh')"
        :aria-label="t('fileAnnotations.refresh')"
        @click="emit('refresh')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
    </header>
    <p
      v-for="failure in failures"
      :key="failure.label"
      role="alert"
      data-testid="file-annotations-failure"
      class="flex-none border-b border-border px-3 py-1.5 text-[12px] text-err"
    >
      {{ t("fileAnnotations.providerFailed", failure) }}
    </p>
    <p v-if="actionError" role="alert" data-testid="file-annotations-error" class="flex-none border-b border-border px-3 py-1.5 text-[12px] text-err">
      {{ actionError }}
    </p>
    <div ref="listEl" class="min-h-0 flex-auto overflow-y-auto">
      <article
        v-for="thread in threads"
        :key="thread.key"
        data-testid="file-annotation-thread"
        :data-thread="thread.key"
        class="border-b border-border px-3 py-2"
        :class="thread.key === activeKey ? 'bg-selected' : ''"
      >
        <button
          type="button"
          data-testid="file-annotation-where"
          class="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[12px] text-muted hover:text-fg"
          @click="emit('reveal', thread.key)"
        >
          <span class="flex-auto truncate">{{ where(thread) }}</span>
          <span class="flex-none">{{ thread.provider.label }}</span>
        </button>
        <blockquote v-if="thread.quote" class="mt-1 line-clamp-3 border-l-2 border-amber pl-2 text-[12px] text-secondary">{{ thread.quote }}</blockquote>
        <div v-for="comment in [thread, ...thread.replies]" :key="comment.id" class="mt-1.5" :class="comment.id === thread.id ? '' : 'ml-3'">
          <p class="text-[12px] text-muted">
            <span class="text-secondary">{{ comment.author }}</span> <span>{{ when(comment) }}</span>
          </p>
          <!-- Plain text, never rendered: this is somebody else's words from somebody else's system. -->
          <p class="whitespace-pre-wrap break-words text-fg">{{ comment.body }}</p>
        </div>
        <textarea
          v-if="thread.canReply"
          v-model="drafts[thread.key]"
          data-testid="file-annotation-reply-input"
          rows="2"
          class="mt-2 w-full resize-y rounded-md border border-border bg-base px-2 py-1 text-[13px] text-fg"
          :placeholder="t('fileAnnotations.replyPlaceholder')"
          :aria-label="t('fileAnnotations.replyPlaceholder')"
          :disabled="busyKey === thread.key"
          @keydown="onReplyKey($event, thread.key)"
        />
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            v-if="thread.canReply"
            type="button"
            data-testid="file-annotation-reply"
            :class="BUTTON"
            :disabled="busyKey !== null || !(drafts[thread.key] ?? '').trim()"
            @click="send(thread.key)"
          >
            {{ busyKey === thread.key ? t("fileAnnotations.working") : t("fileAnnotations.reply") }}
          </button>
          <button
            v-if="thread.canResolve"
            type="button"
            data-testid="file-annotation-resolve"
            :class="BUTTON"
            :disabled="busyKey !== null"
            @click="emit('resolve', thread.key)"
          >
            {{ t("fileAnnotations.resolve") }}
          </button>
          <button
            v-if="canAsk"
            type="button"
            data-testid="file-annotation-ask"
            :class="BUTTON"
            :data-tip="t('fileAnnotations.askTip')"
            @click="emit('ask', [thread.key])"
          >
            {{ t("fileAnnotations.ask") }}
          </button>
        </div>
      </article>
    </div>
  </aside>
</template>
