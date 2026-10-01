// Where a file's comments are, in the Files pane's editor: a mark in the gutter beside the first
// line of each thread, and a tint across the lines it is about (common/fileAnnotations.ts). The
// threads themselves are drawn by the panel beside the editor; this only says WHERE, and tells the
// panel which one was clicked.
//
// The marks ride the document. A provider placed each thread on a line of the file as it was read;
// from then on the reader may type above it, and the mark has to stay with its passage rather than
// with its number — the same thing the change marks next door do (cmChangeGutter.ts).
import { Compartment, StateField, RangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view";

/** One line that has comments. `keys` are the threads starting there, in the panel's order. */
export interface AnnotationMark {
  /** 1-based. Past the end of the document it is clamped to the last line rather than dropped: the
   *  file may be shorter than the one the provider read, and a comment shown a line late is found
   *  where one shown nowhere is not. */
  line: number;
  /** How many lines the passage covers, at least 1. */
  span: number;
  keys: readonly string[];
}

class AnnotationMarker extends GutterMarker {
  readonly keys: readonly string[];
  readonly span: number;
  readonly onPick: (key: string) => void;
  constructor(keys: readonly string[], span: number, onPick: (key: string) => void) {
    super();
    this.keys = keys;
    this.span = span;
    this.onPick = onPick;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof AnnotationMarker && other.span === this.span && other.keys.join("\n") === this.keys.join("\n");
  }
  override toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "material-symbols-outlined";
    mark.textContent = "comment";
    mark.dataset.annotation = this.keys.join(" ");
    mark.setAttribute("aria-hidden", "true");
    // The app's own token, so the mark follows the theme; sized here because the icon font
    // otherwise inherits the gutter's line height and overflows the row.
    mark.style.cssText = "font-size:13px;line-height:inherit;color:var(--amber);cursor:pointer";
    // On the mark itself rather than through the gutter's own handlers: those find the line from
    // the pointer's height, and the mark already knows which threads it stands for.
    const [first] = this.keys;
    if (first !== undefined) {
      mark.addEventListener("mousedown", (event) => {
        // The editor would otherwise move the caret to this line and take the keyboard.
        event.preventDefault();
        this.onPick(first);
      });
    }
    return mark;
  }
}

/** The marks merged so each line has one: two threads on a line share a mark, and the tint covers
 *  the longer passage. Exported for the spec. */
export function marksByLine(marks: readonly AnnotationMark[], lines: number): AnnotationMark[] {
  const byLine = new Map<number, AnnotationMark>();
  for (const mark of marks) {
    const line = Math.min(Math.max(Math.trunc(mark.line), 1), lines);
    const span = Math.max(Math.trunc(mark.span), 1);
    const kept = byLine.get(line);
    byLine.set(line, kept ? { line, span: Math.max(kept.span, span), keys: [...kept.keys, ...mark.keys] } : { line, span, keys: mark.keys });
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const TINT = Decoration.line({ class: "cm-annotated-line" });

/** The line each mark is on NOW, by thread key. */
function linesByKey(state: EditorState, set: RangeSet<GutterMarker>): Map<string, number> {
  const found = new Map<string, number>();
  const cursor = set.iter();
  for (; cursor.value !== null; cursor.next()) {
    const marker = cursor.value;
    if (!(marker instanceof AnnotationMarker)) continue;
    const line = state.doc.lineAt(cursor.from).number;
    marker.keys.forEach((key) => found.set(key, line));
  }
  return found;
}

function tintedLines(state: EditorState, set: RangeSet<GutterMarker>): RangeSet<Decoration> {
  const numbers = new Set<number>();
  const cursor = set.iter();
  for (; cursor.value !== null; cursor.next()) {
    const marker = cursor.value;
    if (!(marker instanceof AnnotationMarker)) continue;
    const first = state.doc.lineAt(cursor.from).number;
    const last = Math.min(first + marker.span - 1, state.doc.lines);
    for (let line = first; line <= last; line += 1) numbers.add(line);
  }
  const ranges: Range<Decoration>[] = [...numbers].sort((a, b) => a - b).map((line) => TINT.range(state.doc.line(line).from));
  return Decoration.set(ranges);
}

export interface AnnotationGutter {
  extension: Extension;
  /** The 1-based line a thread's mark is on in `state`, or null when it has none. */
  lineOf: (state: EditorState, key: string) => number | null;
}

/** The gutter and tint for `marks`. `onPick` hears the first thread of a clicked mark. */
export function annotationGutter(marks: readonly AnnotationMark[], onPick: (key: string) => void): AnnotationGutter {
  const field = StateField.define<RangeSet<GutterMarker>>({
    create: (state) =>
      RangeSet.of(
        marksByLine(marks, state.doc.lines).map((mark) => new AnnotationMarker(mark.keys, mark.span, onPick).range(state.doc.line(mark.line).from)),
        true,
      ),
    update: (value, tr) => (tr.docChanged ? value.map(tr.changes) : value),
  });
  return {
    extension: [
      field,
      gutter({ class: "cm-annotation-gutter", markers: (view) => view.state.field(field) }),
      EditorView.decorations.compute([field], (state) => tintedLines(state, state.field(field))),
      EditorView.baseTheme({
        ".cm-annotation-gutter": { width: "16px" },
        ".cm-annotated-line": { backgroundColor: "color-mix(in srgb, var(--amber) 16%, transparent)" },
      }),
    ],
    lineOf: (state, key) => (state.field(field, false) ? (linesByKey(state, state.field(field)).get(key) ?? null) : null),
  };
}

/** The editor's place for annotations: one compartment, and the marks it was last given.
 *
 *  The marks are kept HERE rather than in the editor's state because loading a file replaces that
 *  whole state (cmEditor.ts says why), and a re-read of the same file must keep its comments until
 *  the next answer arrives. */
export interface AnnotationSlot {
  /** For a new EditorState: the compartment, holding whatever was last set. */
  initial: () => Extension;
  /** The two methods the editor offers for this, bound to its view. */
  api: (view: EditorView) => {
    setAnnotations: (marks: readonly AnnotationMark[], onPick: (key: string) => void) => void;
    annotationLine: (key: string) => number | null;
  };
}

export function annotationSlot(): AnnotationSlot {
  const compartment = new Compartment();
  let current: AnnotationGutter | null = null;
  return {
    initial: () => compartment.of(current?.extension ?? []),
    api: (view) => ({
      setAnnotations(marks, onPick) {
        current = marks.length > 0 ? annotationGutter(marks, onPick) : null;
        view.dispatch({ effects: compartment.reconfigure(current?.extension ?? []) });
      },
      annotationLine: (key) => current?.lineOf(view.state, key) ?? null,
    }),
  };
}
