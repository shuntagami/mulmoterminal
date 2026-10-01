import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref, shallowRef } from "vue";
import { flushPromises } from "@vue/test-utils";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import { marksFor, shownThreads, useFileAnnotations } from "../../../src/composables/useFileAnnotations";
import type { AnnotationProvider, FileAnnotationSet } from "../../../common/fileAnnotations";
import type { CmEditor } from "../../../src/components/cmEditor";

const STUDIO: AnnotationProvider = { id: "studio", label: "Studio", command: "studio", extensions: ["md"] };
const wire = (id: string, line: number | null, over: Record<string, unknown> = {}) => ({
  id,
  author: "Client",
  body: `about ${id}`,
  line,
  canResolve: true,
  ...over,
});
const setOf = (threads: unknown[], over: Record<string, unknown> = {}) => ({
  provider: { id: "studio", label: "Studio" },
  threads,
  instructions: null,
  error: null,
  ...over,
});

interface Call {
  method: string;
  path: string | null;
  body: Record<string, unknown> | null;
}
let calls: Call[] = [];
let listAnswer: unknown = { sets: [] };
let postAnswer: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { ok: true, reply: null } };

function serve(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://x");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.searchParams.get("path"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "POST") return { ok: postAnswer.ok, status: postAnswer.status, json: async () => postAnswer.body };
    return { ok: true, status: 200, json: async () => listAnswer };
  }) as unknown as typeof fetch;
}

function setup(path: string | null = "a.md") {
  const editor = fakeCmEditor();
  const deps = {
    cwd: () => "/proj",
    openPath: ref<string | null>(path),
    unpreviewable: ref<string | null>(null),
    baseVersion: ref<string | null>("v1"),
    editor: shallowRef<CmEditor | null>(editor),
    editSeq: ref(0),
    providers: ref<AnnotationProvider[]>([STUDIO]),
  };
  return { editor, deps, annotations: useFileAnnotations(deps) };
}
const lastMarks = (editor: ReturnType<typeof fakeCmEditor>) => editor.setAnnotations.mock.calls.at(-1)?.[0];

describe("shownThreads and marksFor", () => {
  const sets: FileAnnotationSet[] = [
    { provider: { id: "a", label: "A" }, instructions: null, error: null, threads: [{ ...shape("x", 9, 11) }, { ...shape("y", null, null) }] },
    { provider: { id: "b", label: "B" }, instructions: null, error: null, threads: [{ ...shape("x", 2, 2) }] },
  ];
  function shape(id: string, line: number | null, endLine: number | null) {
    return {
      id,
      author: "",
      body: "",
      createdAt: null,
      line,
      endLine,
      placement: line === null ? ("unplaced" as const) : ("exact" as const),
      quote: null,
      replies: [],
      canReply: true,
      canResolve: false,
    };
  }

  // Two providers may both call a thread "x"; the key is what keeps them apart.
  it("lists every provider's threads down the file, unplaced ones last, under keys that cannot collide", () => {
    expect(shownThreads(sets).map((thread) => thread.key)).toEqual(["b:x", "a:x", "a:y"]);
  });

  it("gives the editor a mark for each placed thread, as long as its passage", () => {
    expect(marksFor(shownThreads(sets))).toEqual([
      { line: 2, span: 1, keys: ["b:x"] },
      { line: 9, span: 3, keys: ["a:x"] },
    ]);
  });
});

describe("useFileAnnotations", () => {
  beforeEach(() => {
    calls = [];
    listAnswer = { sets: [setOf([wire("t1", 4), wire("t2", 9)])] };
    postAnswer = { ok: true, status: 200, body: { ok: true, reply: null } };
    serve();
  });

  it("reads the open file's comments and tells the editor where they are", async () => {
    const { editor, annotations } = setup();
    await annotations.refresh();
    expect(calls).toEqual([{ method: "GET", path: "a.md", body: null }]);
    expect(annotations.threads.value.map((thread) => thread.key)).toEqual(["studio:t1", "studio:t2"]);
    expect(lastMarks(editor)).toEqual([
      { line: 4, span: 1, keys: ["studio:t1"] },
      { line: 9, span: 1, keys: ["studio:t2"] },
    ]);
  });

  // Most users declare no provider, and most files are not Markdown: neither costs a request.
  it("asks the server nothing for a file no provider covers", async () => {
    const { annotations } = setup("src/a.ts");
    await annotations.refresh();
    expect(annotations.covered.value).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reads again when the file changes on disk, and forgets the last file's comments at once", async () => {
    const { deps, annotations } = setup();
    await annotations.refresh();
    deps.baseVersion.value = "v2";
    await flushPromises();
    expect(calls).toHaveLength(2);
    deps.openPath.value = "b.md";
    // Before any answer for b.md: nothing of a.md's is left to draw against the new text.
    expect(annotations.threads.value).toEqual([]);
    await flushPromises();
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: "b.md" });
  });

  // The answer for the file that was open must not land on the one that is.
  it("drops an answer that arrives after another file was opened", async () => {
    const { deps, annotations } = setup();
    const slow = annotations.refresh();
    deps.openPath.value = "src/a.ts";
    await slow;
    await flushPromises();
    expect(annotations.threads.value).toEqual([]);
  });

  it("says which provider failed, beside the threads of the ones that did not", async () => {
    listAnswer = {
      sets: [setOf([], { error: "not logged in" }), setOf([wire("n1", 1)], { provider: { id: "notes", label: "Notes" }, instructions: "Sync first." })],
    };
    const { annotations } = setup();
    await annotations.refresh();
    expect(annotations.failures.value).toEqual([{ label: "Studio", error: "not logged in" }]);
    expect(annotations.threads.value.map((thread) => thread.key)).toEqual(["notes:n1"]);
    expect(annotations.instructions.value).toBe("Sync first.");
  });

  it("adds the reply the provider says it stored, without reading everything again", async () => {
    postAnswer.body = { ok: true, reply: { id: "r9", author: "Me", body: "Fixed.", createdAt: null } };
    const { annotations } = setup();
    await annotations.refresh();
    expect(await annotations.reply("studio:t1", "Fixed.")).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "a.md", body: { op: "reply", provider: "studio", threadId: "t1", body: "Fixed." } });
    expect(annotations.threads.value[0]?.replies).toEqual([{ id: "r9", author: "Me", body: "Fixed.", createdAt: null }]);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("reads the comments again when the provider does not say what it stored", async () => {
    const { annotations } = setup();
    await annotations.refresh();
    await annotations.reply("studio:t1", "Fixed.");
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
  });

  // A provider that stored the first attempt can recognise the second by its id, and not post twice.
  it("retries a failed reply under the same id, and a reworded one under a new id", async () => {
    postAnswer = { ok: false, status: 502, body: { error: "the provider did not answer in time" } };
    const { annotations } = setup();
    await annotations.refresh();
    expect(await annotations.reply("studio:t1", "Fixed.")).toBe(false);
    expect(annotations.actionError.value).toBe("the provider did not answer in time");
    await annotations.reply("studio:t1", "Fixed.");
    await annotations.reply("studio:t1", "Fixed it.");
    const ids = calls.filter((call) => call.method === "POST").map((call) => call.body?.requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("sends nothing for an empty reply", async () => {
    const { annotations } = setup();
    await annotations.refresh();
    expect(await annotations.reply("studio:t1", "   ")).toBe(false);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  // The other threads stay where the reader's typing has carried them: the provider's lines are
  // for the file as it was read, and nothing was read again.
  it("removes a resolved thread and leaves the others where the editor has them", async () => {
    const { editor, annotations } = setup();
    await annotations.refresh();
    editor.annotationLine.mockImplementation((key: string) => (key === "studio:t2" ? 12 : null));
    await annotations.resolve("studio:t1");
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: { op: "resolve", provider: "studio", threadId: "t1" } });
    expect(annotations.threads.value.map((thread) => thread.key)).toEqual(["studio:t2"]);
    expect(lastMarks(editor)).toEqual([{ line: 12, span: 1, keys: ["studio:t2"] }]);
  });

  it("keeps a thread the provider refused to resolve, and says why", async () => {
    postAnswer = { ok: false, status: 502, body: { error: "push your changes first" } };
    const { annotations } = setup();
    await annotations.refresh();
    await annotations.resolve("studio:t1");
    expect(annotations.threads.value).toHaveLength(2);
    expect(annotations.actionError.value).toBe("push your changes first");
  });

  it("answers a thread's line from the editor, which follows typing, else from the provider", async () => {
    const { editor, annotations } = setup();
    await annotations.refresh();
    const [first] = annotations.threads.value;
    if (!first) throw new Error("fixture");
    expect(annotations.lineOf(first)).toBe(4);
    editor.annotationLine.mockReturnValue(7);
    expect(annotations.lineOf(first)).toBe(7);
  });

  it("remembers the thread whose mark was clicked", async () => {
    const { editor, annotations } = setup();
    await annotations.refresh();
    const onPick = editor.setAnnotations.mock.calls.at(-1)?.[1] as (key: string) => void;
    onPick("studio:t2");
    await nextTick();
    expect(annotations.activeKey.value).toBe("studio:t2");
  });
});
