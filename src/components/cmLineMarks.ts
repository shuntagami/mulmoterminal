// LINE MARKS in the Files pane's editor: a mark in the gutter beside a line, and a tint across the
// lines it stands for. What a mark MEANS is not known here — a file panel (common/filePanels.ts)
// asks for them, and hears which one was clicked.
//
// The marks ride the document. Whoever asked placed each on a line of the file as it was then;
// from then on the reader may type above it, and the mark has to stay with its passage rather than
// with its number — the same thing the change marks next door do (cmChangeGutter.ts).
import { Compartment, StateField, RangeSet, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view";

/** One marked line. `keys` are the marks that start there, in the order they were asked for. */
export interface LineMark {
  /** 1-based. Past the end of the document it is clamped to the last line rather than dropped: the
   *  file may be shorter than the one the mark was placed in, and a mark shown a line late is found
   *  where one shown nowhere is not. */
  line: number;
  /** How many lines the passage covers, at least 1. */
  span: number;
  keys: readonly string[];
}

class LineMarker extends GutterMarker {
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
    return other instanceof LineMarker && other.span === this.span && other.keys.join("\n") === this.keys.join("\n");
  }
  override toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "material-symbols-outlined";
    mark.textContent = "bookmark";
    mark.dataset.lineMark = this.keys.join(" ");
    mark.setAttribute("aria-hidden", "true");
    // The app's own token, so the mark follows the theme; sized here because the icon font
    // otherwise inherits the gutter's line height and overflows the row.
    mark.style.cssText = "font-size:13px;line-height:inherit;color:var(--amber);cursor:pointer";
    // On the mark itself rather than through the gutter's own handlers: those find the line from
    // the pointer's height, and the mark already knows what it stands for.
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

/** The marks merged so each line has one: two that start on a line share a mark, and the tint
 *  covers the longer passage. Exported for the spec. */
export function marksByLine(marks: readonly LineMark[], lines: number): LineMark[] {
  const byLine = new Map<number, LineMark>();
  for (const mark of marks) {
    const line = Math.min(Math.max(Math.trunc(mark.line), 1), lines);
    const span = Math.max(Math.trunc(mark.span), 1);
    const kept = byLine.get(line);
    byLine.set(line, kept ? { line, span: Math.max(kept.span, span), keys: [...kept.keys, ...mark.keys] } : { line, span, keys: mark.keys });
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const TINT = Decoration.line({ class: "cm-marked-line" });

/** The line each mark is on NOW, by key. */
function linesByKey(state: EditorState, set: RangeSet<GutterMarker>): Map<string, number> {
  const found = new Map<string, number>();
  const cursor = set.iter();
  for (; cursor.value !== null; cursor.next()) {
    const marker = cursor.value;
    if (!(marker instanceof LineMarker)) continue;
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
    if (!(marker instanceof LineMarker)) continue;
    const first = state.doc.lineAt(cursor.from).number;
    const last = Math.min(first + marker.span - 1, state.doc.lines);
    for (let line = first; line <= last; line += 1) numbers.add(line);
  }
  const ranges: Range<Decoration>[] = [...numbers].sort((a, b) => a - b).map((line) => TINT.range(state.doc.line(line).from));
  return Decoration.set(ranges);
}

export interface LineMarkGutter {
  extension: Extension;
  /** The 1-based line the mark `key` is on in `state`, or null when there is no such mark. */
  lineOf: (state: EditorState, key: string) => number | null;
}

/** The gutter and tint for `marks`. `onPick` hears the first key of a clicked mark. */
export function lineMarkGutter(marks: readonly LineMark[], onPick: (key: string) => void): LineMarkGutter {
  const field = StateField.define<RangeSet<GutterMarker>>({
    create: (state) =>
      RangeSet.of(
        marksByLine(marks, state.doc.lines).map((mark) => new LineMarker(mark.keys, mark.span, onPick).range(state.doc.line(mark.line).from)),
        true,
      ),
    update: (value, tr) => (tr.docChanged ? value.map(tr.changes) : value),
  });
  return {
    extension: [
      field,
      gutter({ class: "cm-line-mark-gutter", markers: (view) => view.state.field(field) }),
      EditorView.decorations.compute([field], (state) => tintedLines(state, state.field(field))),
      EditorView.baseTheme({
        ".cm-line-mark-gutter": { width: "16px" },
        ".cm-marked-line": { backgroundColor: "color-mix(in srgb, var(--amber) 16%, transparent)" },
      }),
    ],
    lineOf: (state, key) => (state.field(field, false) ? (linesByKey(state, state.field(field)).get(key) ?? null) : null),
  };
}

/** The editor's place for line marks: one compartment, and the marks it was last given.
 *
 *  The marks are kept HERE rather than in the editor's state because loading a file replaces that
 *  whole state (cmEditor.ts says why), and a re-read of the same file must keep its marks until
 *  whoever placed them places them again. */
export interface LineMarkSlot {
  /** For a new EditorState: the compartment, holding whatever was last set. */
  initial: () => Extension;
  /** The two methods the editor offers for this, bound to its view. */
  api: (view: EditorView) => {
    setLineMarks: (marks: readonly LineMark[], onPick: (key: string) => void) => void;
    lineMarkLine: (key: string) => number | null;
  };
}

export function lineMarkSlot(): LineMarkSlot {
  const compartment = new Compartment();
  let current: LineMarkGutter | null = null;
  return {
    initial: () => compartment.of(current?.extension ?? []),
    api: (view) => ({
      setLineMarks(marks, onPick) {
        current = marks.length > 0 ? lineMarkGutter(marks, onPick) : null;
        view.dispatch({ effects: compartment.reconfigure(current?.extension ?? []) });
      },
      lineMarkLine: (key) => current?.lineOf(view.state, key) ?? null,
    }),
  };
}
