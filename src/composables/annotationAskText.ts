// What the comments panel's "Ask the agent" types at the terminal's prompt, as a composable so the
// pane only has to emit it — the @ button's shape (selectionReferenceText.ts), and its rule: the
// agent reads the file ON DISK, so unsaved edits are saved first, or the lines name other text.
import { annotationPrompt } from "../components/annotationPrompt";
import { selectionReference } from "../components/selectionReference";
import type { FileAnnotations } from "./useFileAnnotations";
import type { OpenFile } from "./useOpenFile";

export interface AnnotationAskDeps {
  file: OpenFile;
  annotations: FileAnnotations;
  /** Whether there is a terminal beside the pane to insert into. */
  hasTarget: () => boolean;
  cwd: () => string | null;
  terminalCwd: () => string | null;
}

/** The request for the threads named by `keys`, or null when there is nothing to insert into,
 *  none of them is still there, or the save that had to come first did not land. */
export async function annotationAskText(deps: AnnotationAskDeps, keys: readonly string[]): Promise<string | null> {
  const { file, annotations } = deps;
  const pathRel = file.openPath.value;
  if (!deps.hasTarget() || !pathRel) return null;
  // Read before the save: saving re-reads the file and the comments with it.
  const threads = annotations.threads.value
    .filter((thread) => keys.includes(thread.key))
    .map((thread) => ({ ...thread, currentLine: annotations.lineOf(thread), providerLabel: thread.provider.label }));
  const instructions = annotations.instructions.value;
  if (threads.length === 0 || !(await file.savedInPlace())) return null;
  const reference = selectionReference({ pathRel, cwd: deps.cwd(), terminalCwd: deps.terminalCwd(), lines: null });
  return reference === null ? null : annotationPrompt(reference, threads, instructions);
}
