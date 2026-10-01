// What the comments panel types at the terminal's prompt for "ask the agent about these": the file,
// what the provider wants an agent told first, and each thread with the id the agent needs to
// answer it through the provider's own tools. Pure — the panel decides which threads, the pane
// decides how the file is spelled at the terminal's end (selectionReference.ts).
//
// English, because it is read by an agent and the reader can reword it before sending; a provider
// that wants its own language says so in `instructions`, which go in verbatim.
import type { AnnotationComment, AnnotationPlacement, AnnotationThread } from "../../common/fileAnnotations";

export interface PromptThread extends AnnotationThread {
  /** The line the thread's mark is on NOW, which the reader's typing may have moved. */
  currentLine: number | null;
  providerLabel: string;
}

const PLACEMENT_NOTE: Record<AnnotationPlacement, string> = {
  exact: "",
  moved: " (moved since the comment was made)",
  estimated: " (position estimated — check the quote)",
  unplaced: "",
};

function where(thread: PromptThread): string {
  if (thread.currentLine === null) return "position unknown";
  const span = thread.line !== null && thread.endLine !== null ? thread.endLine - thread.line : 0;
  const lines = span > 0 ? `lines ${thread.currentLine}-${thread.currentLine + span}` : `line ${thread.currentLine}`;
  return `${lines}${PLACEMENT_NOTE[thread.placement]}`;
}

const indented = (text: string, pad: string): string => text.split("\n").join(`\n${pad}`);
const replyLine = (reply: AnnotationComment): string => `     - reply (${reply.author || "unknown"}): ${indented(reply.body, "       ")}`;

function threadBlock(thread: PromptThread, index: number): string {
  const head = `${index + 1}. ${where(thread)} — ${thread.author || "unknown"} [${thread.providerLabel}] / thread id: ${thread.id}`;
  // The quote on one line: it is there to be searched for, and a line break inside it reads as the
  // start of the comment.
  const quote = thread.quote ? [`   Quote: "${thread.quote.replace(/\n/g, " ")}"`] : [];
  return [head, ...quote, `   ${indented(thread.body, "   ")}`, ...thread.replies.map(replyLine)].join("\n");
}

/** The text to insert. `reference` is the file as the terminal should name it (`@docs/a.md `), and
 *  `instructions` the providers' own, already joined. */
export function annotationPrompt(reference: string, threads: readonly PromptThread[], instructions: string | null): string {
  const opening = `${reference.trim()} has review comments. Address each one in the file, then say what you changed and why.`;
  const told = instructions ? ["", instructions.trim()] : [];
  return [opening, ...told, "", "Comments:", ...threads.map(threadBlock)].join("\n");
}
