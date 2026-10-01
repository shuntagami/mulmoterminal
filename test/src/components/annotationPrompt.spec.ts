import { describe, it, expect } from "vitest";
import { annotationPrompt, type PromptThread } from "../../../src/components/annotationPrompt";

const thread = (over: Partial<PromptThread> = {}): PromptThread => ({
  id: "t1",
  author: "Client",
  body: "Too long.\nCut the second half.",
  createdAt: null,
  line: 4,
  endLine: 4,
  placement: "exact",
  quote: "a very long\nsentence",
  replies: [],
  canReply: true,
  canResolve: false,
  currentLine: 4,
  providerLabel: "Studio",
  ...over,
});

describe("annotationPrompt", () => {
  it("names the file, then each thread with the id an agent answers it by", () => {
    expect(annotationPrompt("@docs/a.md ", [thread()], null)).toBe(
      [
        "@docs/a.md has review comments. Address each one in the file, then say what you changed and why.",
        "",
        "Comments:",
        "1. line 4 — Client [Studio] / thread id: t1",
        '   Quote: "a very long sentence"',
        "   Too long.",
        "   Cut the second half.",
      ].join("\n"),
    );
  });

  // What the provider wants an agent told first — a sync step, a tool to call when done.
  it("puts the provider's instructions before the comments, as written", () => {
    const text = annotationPrompt("@a.md ", [thread()], "同期してから編集してください。");
    expect(text.split("\n").slice(1, 4)).toEqual(["", "同期してから編集してください。", ""]);
  });

  // The line is where the mark is NOW, and how sure the provider was is said beside it.
  it("uses the line the reader's typing has moved the thread to, and says how it was placed", () => {
    const text = annotationPrompt(
      "@a.md ",
      [
        thread({ currentLine: 9, endLine: 6, placement: "moved" }),
        thread({ id: "t2", placement: "estimated" }),
        thread({ id: "t3", currentLine: null, line: null, endLine: null, placement: "unplaced" }),
      ],
      null,
    );
    expect(text).toContain("1. lines 9-11 (moved since the comment was made) — Client");
    expect(text).toContain("2. line 4 (position estimated — check the quote) — Client");
    expect(text).toContain("3. position unknown — Client");
  });

  it("includes the replies already made, and leaves out a quote that is not there", () => {
    const text = annotationPrompt("@a.md ", [thread({ quote: null, replies: [{ id: "r1", author: "", body: "Agreed.", createdAt: null }] })], null);
    expect(text).not.toContain("Quote:");
    expect(text).toContain("     - reply (unknown): Agreed.");
  });
});
