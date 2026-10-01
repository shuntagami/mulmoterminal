// The Files pane's end of file annotations, as ONE value the pane binds to the panel — the pane is
// at its size limit, and everything here reads only what the pane already has.
//
// `panel` is null whenever there is nothing to show: no provider covers the file, the file is not
// text, or the Preview is on screen. The Preview is another document with no lines to hang a
// comment on, which is the whole rule for where comments appear.
import { computed, type ComputedRef } from "vue";
import { annotationAskText } from "./annotationAskText";
import { annotationProviders } from "./annotationProviders";
import { useFileAnnotations, type ShownThread } from "./useFileAnnotations";
import type { OpenFile } from "./useOpenFile";

/** What the pane knows that this needs, read when used — the pane's props change under it. */
export interface FilesPaneAnnotationsHost {
  cwd: string | null;
  /** Whether there is a terminal beside the pane to put a request in, and where it is. */
  insertTarget?: boolean | undefined;
  insertTargetCwd?: string | null | undefined;
}

/** FileAnnotationsPanel's props and listeners, for `v-bind`. */
export interface AnnotationsPanelBinding {
  threads: readonly ShownThread[];
  failures: readonly { label: string; error: string }[];
  activeKey: string | null;
  busyKey: string | null;
  actionError: string | null;
  canAsk: boolean;
  lineOf: (thread: ShownThread) => number | null;
  reply: (key: string, body: string) => Promise<boolean>;
  onReveal: (key: string) => void;
  onResolve: (key: string) => void;
  onAsk: (keys: string[]) => void;
  onRefresh: () => void;
}

export function useFilesPaneAnnotations(
  file: OpenFile,
  host: () => FilesPaneAnnotationsHost,
  /** The pane's own emit: a request for the agent goes out the way the @ button's text does. */
  emit: (event: "insert-text", text: string) => void,
): ComputedRef<AnnotationsPanelBinding | null> {
  const annotations = useFileAnnotations({
    cwd: () => host().cwd,
    openPath: file.openPath,
    unpreviewable: file.unpreviewable,
    baseVersion: file.baseVersion,
    editor: file.editor,
    editSeq: file.editSeq,
    providers: annotationProviders,
  });

  function reveal(key: string): void {
    const thread = annotations.threads.value.find((entry) => entry.key === key);
    const line = thread ? annotations.lineOf(thread) : null;
    annotations.activeKey.value = key;
    if (line !== null) file.editor.value?.revealLine(line);
  }

  /** "Ask the agent": the request for these threads, at the terminal's prompt, not sent. */
  async function ask(keys: string[]): Promise<void> {
    const deps = { file, annotations, hasTarget: () => !!host().insertTarget, cwd: () => host().cwd, terminalCwd: () => host().insertTargetCwd ?? null };
    const text = await annotationAskText(deps, keys);
    if (text !== null) emit("insert-text", text);
  }

  return computed(() => {
    const nothing = annotations.threads.value.length === 0 && annotations.failures.value.length === 0;
    if (!file.openPath.value || file.unpreviewable.value || file.showPreview.value || nothing) return null;
    return {
      threads: annotations.threads.value,
      failures: annotations.failures.value,
      activeKey: annotations.activeKey.value,
      busyKey: annotations.busyKey.value,
      actionError: annotations.actionError.value,
      canAsk: !!host().insertTarget,
      lineOf: annotations.lineOf,
      reply: annotations.reply,
      onReveal: reveal,
      onResolve: (key) => void annotations.resolve(key),
      onAsk: (keys) => void ask(keys),
      onRefresh: () => void annotations.refresh(),
    };
  });
}
