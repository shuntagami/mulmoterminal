import { describe, it, expect, vi } from "vitest";
import { EditorView } from "codemirror";
import { createEditor } from "../../../src/components/cmEditor";
import { marksByLine } from "../../../src/components/cmAnnotationGutter";

const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
Range.prototype.getClientRects = () => Object.assign([EMPTY_RECT], { item: () => EMPTY_RECT });
Range.prototype.getBoundingClientRect = () => EMPTY_RECT;

const mountEditor = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor(host, () => {});
  const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content") ?? host);
  if (!view) throw new Error("no editor view");
  return { editor, host, view };
};
const marksIn = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>(".cm-annotation-gutter [data-annotation]")].map((el) => el.dataset.annotation ?? "");
const tintedIn = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>(".cm-annotated-line")].map((el) => el.textContent ?? "");
const DOC = "one\ntwo\nthree\nfour";

describe("marksByLine", () => {
  it("gives two threads on one line a single mark, covering the longer passage", () => {
    expect(
      marksByLine(
        [
          { line: 2, span: 1, keys: ["a"] },
          { line: 2, span: 3, keys: ["b"] },
          { line: 1, span: 1, keys: ["c"] },
        ],
        10,
      ),
    ).toEqual([
      { line: 1, span: 1, keys: ["c"] },
      { line: 2, span: 3, keys: ["a", "b"] },
    ]);
  });

  // The file may be shorter than the one the provider read. Shown a line late beats shown nowhere.
  it("clamps a line past the end of the document to its last line", () => {
    expect(
      marksByLine(
        [
          { line: 99, span: 1, keys: ["a"] },
          { line: 0, span: 0, keys: ["b"] },
        ],
        4,
      ),
    ).toEqual([
      { line: 1, span: 1, keys: ["b"] },
      { line: 4, span: 1, keys: ["a"] },
    ]);
  });
});

// On the real editor: the marks appear, follow typing, survive a re-read, and go when told.
describe("the editor's annotation marks", () => {
  it("marks the first line of a thread and tints the lines it is about", () => {
    const { editor, host } = mountEditor();
    editor.setDoc(DOC, "a.md");
    editor.setAnnotations([{ line: 2, span: 2, keys: ["studio:t1"] }], () => {});
    expect(marksIn(host)).toEqual(["studio:t1"]);
    expect(tintedIn(host)).toEqual(["two", "three"]);
    expect(editor.annotationLine("studio:t1")).toBe(2);
  });

  it("has no gutter at all for a file with no comments", () => {
    const { editor, host } = mountEditor();
    editor.setDoc(DOC, "a.md");
    expect(host.querySelector(".cm-annotation-gutter")).toBeNull();
    expect(editor.annotationLine("studio:t1")).toBeNull();
  });

  // The provider placed the thread on a line of the file as it was read; typing above it must move
  // the mark with its passage, not leave it on the number.
  it("stays with its passage as the reader types above it", () => {
    const { editor, host, view } = mountEditor();
    editor.setDoc(DOC, "a.md");
    editor.setAnnotations([{ line: 3, span: 1, keys: ["studio:t1"] }], () => {});
    view.dispatch({ changes: { from: 0, insert: "zero\nhalf\n" } });
    expect(editor.annotationLine("studio:t1")).toBe(5);
    expect(tintedIn(host)).toEqual(["three"]);
  });

  // Loading replaces the editor's whole state; a re-read of the same file keeps its comments until
  // the next answer arrives.
  it("keeps the marks across a re-read of the file", () => {
    const { editor, host } = mountEditor();
    editor.setAnnotations([{ line: 2, span: 1, keys: ["studio:t1"] }], () => {});
    editor.setDoc(DOC, "a.md");
    expect(marksIn(host)).toEqual(["studio:t1"]);
    expect(tintedIn(host)).toEqual(["two"]);
  });

  it("tells the pane which thread's mark was clicked", () => {
    const { editor, host } = mountEditor();
    const onPick = vi.fn();
    editor.setDoc(DOC, "a.md");
    editor.setAnnotations([{ line: 2, span: 1, keys: ["studio:t1", "studio:t2"] }], onPick);
    const mark = host.querySelector<HTMLElement>(".cm-annotation-gutter [data-annotation]");
    mark?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onPick).toHaveBeenCalledWith("studio:t1");
  });

  it("removes the marks once told there are none", () => {
    const { editor, host } = mountEditor();
    editor.setDoc(DOC, "a.md");
    editor.setAnnotations([{ line: 2, span: 1, keys: ["studio:t1"] }], () => {});
    editor.setAnnotations([], () => {});
    expect(marksIn(host)).toEqual([]);
    expect(tintedIn(host)).toEqual([]);
  });
});
