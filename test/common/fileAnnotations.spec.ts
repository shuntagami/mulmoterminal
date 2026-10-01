import { describe, it, expect } from "vitest";
import {
  ANNOTATION_PROVIDERS_MAX,
  providerCoversFile,
  readAnnotationAction,
  readAnnotationThreads,
  readFileAnnotationSets,
  sanitizeAnnotationProviders,
} from "../../common/fileAnnotations";

const provider = (over: Record<string, unknown> = {}) => ({ id: "studio", label: "Studio", command: "node /opt/comments.mjs", extensions: ["md"], ...over });

describe("sanitizeAnnotationProviders", () => {
  it("keeps a well-formed entry as written", () => {
    expect(sanitizeAnnotationProviders([provider()])).toEqual([provider()]);
  });

  it("is an empty list for anything that is not a list", () => {
    expect(sanitizeAnnotationProviders(undefined)).toEqual([]);
    expect(sanitizeAnnotationProviders({ id: "studio" })).toEqual([]);
  });

  // An entry with no command would be a provider that can never answer; one with a bad id cannot
  // be named on the wire. Both are dropped rather than repaired.
  it("drops an entry with no command or an id that cannot travel", () => {
    expect(sanitizeAnnotationProviders([provider({ command: "  " }), provider({ id: "Has Space" }), provider({ id: 7 })])).toEqual([]);
  });

  it("names an entry after its id when it has no label", () => {
    expect(sanitizeAnnotationProviders([provider({ label: undefined })])[0]?.label).toBe("studio");
  });

  it("reads extensions without their dot, lower-cased, once each", () => {
    expect(sanitizeAnnotationProviders([provider({ extensions: [".MD", "md", "mdx", "*.txt", 3] })])[0]?.extensions).toEqual(["md", "mdx"]);
  });

  it("keeps the first entry of a repeated id, and no more than the limit", () => {
    const many = Array.from({ length: ANNOTATION_PROVIDERS_MAX + 3 }, (_, i) => provider({ id: `p${i}` }));
    expect(sanitizeAnnotationProviders([provider({ label: "First" }), provider({ label: "Second" })])).toHaveLength(1);
    expect(sanitizeAnnotationProviders([provider({ label: "First" }), provider({ label: "Second" })])[0]?.label).toBe("First");
    expect(sanitizeAnnotationProviders(many)).toHaveLength(ANNOTATION_PROVIDERS_MAX);
  });
});

describe("providerCoversFile", () => {
  const [md] = sanitizeAnnotationProviders([provider()]);
  const [any] = sanitizeAnnotationProviders([provider({ extensions: [] })]);
  if (!md || !any) throw new Error("fixture");

  it("asks a provider only about the extensions it named", () => {
    expect(providerCoversFile(md, "docs/Script.MD")).toBe(true);
    expect(providerCoversFile(md, "src/a.ts")).toBe(false);
    expect(providerCoversFile(md, "Makefile")).toBe(false);
  });

  it("asks a provider that named none about every file", () => {
    expect(providerCoversFile(any, "Makefile")).toBe(true);
  });
});

describe("readAnnotationThreads", () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    author: "Client",
    body: "Too long.",
    createdAt: "2026-09-30T01:00:00Z",
    line: 4,
    ...over,
  });

  it("reads a thread, defaulting what a provider may leave out", () => {
    expect(readAnnotationThreads([thread()])).toEqual([
      {
        id: "t1",
        author: "Client",
        body: "Too long.",
        createdAt: "2026-09-30T01:00:00Z",
        line: 4,
        endLine: 4,
        placement: "exact",
        quote: null,
        replies: [],
        canReply: true,
        canResolve: false,
      },
    ]);
  });

  it("is empty for an answer with no list of threads", () => {
    expect(readAnnotationThreads(undefined)).toEqual([]);
    expect(readAnnotationThreads("threads")).toEqual([]);
  });

  // A line that is not a positive whole number is not a place. The thread is still shown — it can
  // be read and answered — but against no line, and never claiming a placement it does not have.
  it("shows a thread with no usable line as unplaced", () => {
    for (const line of [0, -2, 1.5, "4", null, undefined]) {
      expect(readAnnotationThreads([thread({ line, placement: "moved" })])[0]).toMatchObject({ line: null, endLine: null, placement: "unplaced" });
    }
  });

  it("does not let a thread with a line call itself unplaced, nor end before it starts", () => {
    expect(readAnnotationThreads([thread({ placement: "unplaced" })])[0]).toMatchObject({ line: null, placement: "unplaced" });
    expect(readAnnotationThreads([thread({ endLine: 2, placement: "estimated" })])[0]).toMatchObject({ line: 4, endLine: 4, placement: "estimated" });
    expect(readAnnotationThreads([thread({ endLine: 6, placement: "nonsense" })])[0]).toMatchObject({ endLine: 6, placement: "exact" });
  });

  it("drops a thread or a reply that has no id, and the second thread of a repeated one", () => {
    const read = readAnnotationThreads([
      thread({
        replies: [
          { id: "r1", author: "Me", body: "ok" },
          { author: "Me", body: "lost" },
        ],
      }),
      thread({ body: "again" }),
      { body: "no id" },
    ]);
    expect(read).toHaveLength(1);
    expect(read[0]?.body).toBe("Too long.");
    expect(read[0]?.replies).toEqual([{ id: "r1", author: "Me", body: "ok", createdAt: null }]);
  });

  it("offers resolving only when the provider does, and replying unless it refuses", () => {
    expect(readAnnotationThreads([thread({ canResolve: true, canReply: false })])[0]).toMatchObject({ canResolve: true, canReply: false });
    expect(readAnnotationThreads([thread({ canResolve: "yes" })])[0]).toMatchObject({ canResolve: false });
  });
});

describe("readFileAnnotationSets", () => {
  it("reads each provider's threads, instructions and failure", () => {
    const sets = readFileAnnotationSets({
      sets: [
        { provider: { id: "studio", label: "Studio" }, threads: [{ id: "t1", line: 1 }], instructions: "Sync first.", error: null },
        { provider: { id: "other" }, threads: [], error: "not logged in" },
        { threads: [] },
      ],
    });
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ provider: { id: "studio", label: "Studio" }, instructions: "Sync first.", error: null });
    expect(sets[0]?.threads).toHaveLength(1);
    expect(sets[1]).toMatchObject({ provider: { id: "other", label: "other" }, instructions: null, error: "not logged in" });
  });

  it("is empty for a body that is not the route's", () => {
    expect(readFileAnnotationSets(null)).toEqual([]);
    expect(readFileAnnotationSets({ sets: "none" })).toEqual([]);
  });
});

describe("readAnnotationAction", () => {
  it("reads a reply and a resolve", () => {
    expect(readAnnotationAction({ op: "reply", provider: "studio", threadId: "t1", body: "Done.", requestId: "r-1" })).toEqual({
      op: "reply",
      provider: "studio",
      threadId: "t1",
      body: "Done.",
      requestId: "r-1",
    });
    expect(readAnnotationAction({ op: "resolve", provider: "studio", threadId: "t1", body: "ignored" })).toEqual({
      op: "resolve",
      provider: "studio",
      threadId: "t1",
    });
  });

  // An empty reply would be posted to a client as a blank comment.
  it("refuses a reply with nothing in it, and anything that names no thread", () => {
    expect(readAnnotationAction({ op: "reply", provider: "studio", threadId: "t1", body: "   ", requestId: "r-1" })).toBeNull();
    expect(readAnnotationAction({ op: "reply", provider: "studio", threadId: "t1", body: "Done." })).toBeNull();
    expect(readAnnotationAction({ op: "resolve", provider: "studio", threadId: "" })).toBeNull();
    expect(readAnnotationAction({ op: "delete", provider: "studio", threadId: "t1" })).toBeNull();
    expect(readAnnotationAction(null)).toBeNull();
  });
});
