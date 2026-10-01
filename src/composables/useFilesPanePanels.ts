// The Files pane's end of file panels (common/filePanels.ts), as ONE value the pane binds to the
// column — the pane is at its size limit, and everything here reads only what the pane already has.
//
// The binding is null whenever there is nowhere for a panel to be: no panel covers the file, the
// file is not text, or the Preview is on screen. A panel sits beside the SOURCE — its marks are on
// the editor's lines, and the Preview is another document that has none.
import { computed, ref, watch, type ComputedRef } from "vue";
import { panelCoversFile, type FilePanel, type PanelFile, type PanelMark } from "../../common/filePanels";
import { previewThemeFromVars, type PreviewTheme } from "../../common/previewTheme";
import type { LineMark } from "../components/cmLineMarks";
import type { PanelRequestOutcome } from "../components/FilePanelFrame.vue";
import { browseQuery } from "../components/filesPaneApi";
import { selectionReference } from "../components/selectionReference";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { filePanels } from "./filePanels";
import type { OpenFile } from "./useOpenFile";
import { activeThemeVars } from "./useTheme";

/** What the pane knows that this needs, read when used — the pane's props change under it. */
export interface FilesPanePanelsHost {
  cwd: string | null;
  /** Whether there is a terminal beside the pane to put text in, and where it is. */
  insertTarget?: boolean | undefined;
  insertTargetCwd?: string | null | undefined;
}

/** FilePanels' props and listeners, for `v-bind`. */
export interface FilePanelsBinding {
  panels: readonly FilePanel[];
  file: Omit<PanelFile, "content">;
  diskVersion: string | null;
  content: () => string;
  theme: PreviewTheme | null;
  markLines: Record<string, Record<string, number>>;
  clicked: { panel: string; id: string } | null;
  request: (panel: string, payload: unknown) => Promise<PanelRequestOutcome>;
  onMarks: (panel: string, marks: PanelMark[]) => void;
  onReveal: (line: number) => void;
  onInsert: (text: string) => void;
}

// A mark's key in the editor: the panel that asked for it, then the page's own id. Panel ids have
// no colon in them, so the first one is the divider whatever the page called its mark.
const keyOf = (panel: string, id: string): string => `${panel}:${id}`;
const splitKey = (key: string): { panel: string; id: string } => ({ panel: key.slice(0, key.indexOf(":")), id: key.slice(key.indexOf(":") + 1) });

/** Every panel's marks as the editor takes them. Exported for the spec. */
export function lineMarksOf(marksByPanel: Record<string, readonly PanelMark[]>): LineMark[] {
  return Object.entries(marksByPanel).flatMap(([panel, marks]) =>
    marks.map((mark) => ({ line: mark.line, span: mark.endLine - mark.line + 1, keys: [keyOf(panel, mark.id)] })),
  );
}

async function ask(query: string, panel: string, payload: unknown): Promise<PanelRequestOutcome> {
  try {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ panel, payload }) };
    const res = await fetchWithTimeout(`/api/files/browse/panel?${query}`, init, SLOW_COMMAND_TIMEOUT_MS);
    const body = await jsonBody(res);
    if (res.ok) return { ok: true, result: body.result };
    return { ok: false, error: typeof body.error === "string" && body.error ? body.error : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function useFilesPanePanels(
  file: OpenFile,
  host: () => FilesPanePanelsHost,
  /** The pane's own emit: a panel's text goes out the way the @ button's does. */
  emit: (event: "insert-text", text: string) => void,
): ComputedRef<FilePanelsBinding | null> {
  const marksByPanel = ref<Record<string, PanelMark[]>>({});
  const clicked = ref<{ panel: string; id: string } | null>(null);

  const covering = computed(() => {
    const pathRel = file.openPath.value;
    if (!pathRel || file.unpreviewable.value || file.showPreview.value) return [];
    return filePanels.value.filter((panel) => panelCoversFile(panel, pathRel));
  });

  // Tell the editor. On a change of marks, and on a new editor — a re-root makes one that knows
  // nothing of them.
  watch([() => lineMarksOf(marksByPanel.value), file.editor], ([marks, editor]) =>
    editor?.setLineMarks(marks, (key) => {
      clicked.value = splitKey(key);
    }),
  );

  // Where each mark is now. `editSeq` is read only to be depended on: the editor's answer is not
  // reactive, and typing above a mark moves it.
  const markLines = computed(() => {
    const editor = file.editSeq.value >= 0 ? file.editor.value : null;
    const linesOf = (panel: string, marks: readonly PanelMark[]) =>
      Object.fromEntries(marks.map((mark) => [mark.id, editor?.lineMarkLine(keyOf(panel, mark.id)) ?? mark.line]));
    return Object.fromEntries(Object.entries(marksByPanel.value).map(([panel, marks]) => [panel, linesOf(panel, marks)]));
  });

  // Its own computed so the value keeps its identity between recomputations of the binding below:
  // the frame tells the page about the file again whenever the theme CHANGES, and a fresh object
  // every time the reader typed would be a change every time.
  const theme = computed(() => (activeThemeVars.value ? previewThemeFromVars(activeThemeVars.value) : null));

  /** The agent reads the file ON DISK, so unsaved edits are saved first — the @ button's rule. */
  async function insert(text: string): Promise<void> {
    if (host().insertTarget && (await file.savedInPlace())) emit("insert-text", text);
  }

  return computed(() => {
    const pathRel = file.openPath.value;
    if (!pathRel || covering.value.length === 0) return null;
    const { cwd, insertTarget, insertTargetCwd } = host();
    const reference = insertTarget ? selectionReference({ pathRel, cwd, terminalCwd: insertTargetCwd ?? null, lines: null }) : null;
    return {
      panels: covering.value,
      file: { path: pathRel, root: cwd, reference: reference?.trim() ?? null },
      diskVersion: file.baseVersion.value,
      content: () => file.editor.value?.getDoc() ?? "",
      theme: theme.value,
      markLines: markLines.value,
      clicked: clicked.value,
      request: (panel, payload) => ask(browseQuery(cwd, pathRel), panel, payload),
      onMarks: (panel, marks) => {
        const others = Object.entries(marksByPanel.value).filter(([id]) => id !== panel);
        marksByPanel.value = Object.fromEntries(marks.length > 0 ? [...others, [panel, marks]] : others);
      },
      onReveal: (line) => file.editor.value?.revealLine(line),
      onInsert: (text) => void insert(text),
    };
  });
}
