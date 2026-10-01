import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { ShownThread } from "../../../src/composables/useFileAnnotations";

const FileAnnotationsPanel = (await import("../../../src/components/FileAnnotationsPanel.vue")).default;

const thread = (over: Partial<ShownThread> = {}): ShownThread => ({
  id: "t1",
  key: "studio:t1",
  provider: { id: "studio", label: "Studio" },
  author: "Client",
  body: "Too long.",
  createdAt: null,
  line: 4,
  endLine: 4,
  placement: "exact",
  quote: "a very long sentence",
  replies: [{ id: "r1", author: "Me", body: "On it.", createdAt: null }],
  canReply: true,
  canResolve: true,
  ...over,
});

const mountPanel = (over: Record<string, unknown> = {}) => {
  const reply = vi.fn(async () => true);
  const w = mount(FileAnnotationsPanel, {
    props: {
      threads: [thread()],
      failures: [],
      activeKey: null,
      busyKey: null,
      actionError: null,
      canAsk: true,
      lineOf: (shown: ShownThread) => shown.line,
      reply,
      ...over,
    },
  });
  return { w, reply };
};

describe("FileAnnotationsPanel", () => {
  it("shows a thread with its passage, its place, where it came from, and its replies", () => {
    const { w } = mountPanel();
    const text = w.get('[data-testid="file-annotation-thread"]').text();
    expect(text).toContain("Line 4");
    expect(text).toContain("Studio");
    expect(text).toContain("a very long sentence");
    expect(text).toContain("Too long.");
    expect(text).toContain("On it.");
  });

  // The line is the editor's, which the reader's typing moves — not the one the provider gave.
  it("names the line the thread is on now, and says when the place is not certain", () => {
    const { w } = mountPanel({
      threads: [
        thread({ endLine: 6, placement: "moved" }),
        thread({ key: "studio:t2", id: "t2", placement: "estimated" }),
        thread({ key: "studio:t3", id: "t3", line: null, endLine: null, placement: "unplaced" }),
      ],
      lineOf: (shown: ShownThread) => (shown.line === null ? null : shown.line + 10),
    });
    const places = w.findAll('[data-testid="file-annotation-where"]').map((el) => el.text());
    expect(places[0]).toContain("Lines 14–16 · moved");
    expect(places[1]).toContain("Line 14 · position estimated");
    expect(places[2]).toContain("Not found in this text");
  });

  // A comment body is somebody else's text from somebody else's system.
  it("shows a comment's body as text, never as markup", () => {
    const { w } = mountPanel({ threads: [thread({ body: '<img src=x onerror="alert(1)">' })] });
    expect(w.find("img").exists()).toBe(false);
    expect(w.text()).toContain('<img src=x onerror="alert(1)">');
  });

  it("sends what was typed and clears it once the reply has landed", async () => {
    const { w, reply } = mountPanel();
    const input = w.get<HTMLTextAreaElement>('[data-testid="file-annotation-reply-input"]');
    expect(w.get('[data-testid="file-annotation-reply"]').attributes("disabled")).toBeDefined();
    await input.setValue("Fixed in the new draft.");
    await w.get('[data-testid="file-annotation-reply"]').trigger("click");
    await flushPromises();
    expect(reply).toHaveBeenCalledWith("studio:t1", "Fixed in the new draft.");
    expect(input.element.value).toBe("");
  });

  // A reply that did not land is still there to send again.
  it("keeps what was typed when the reply did not land", async () => {
    const { w } = mountPanel({ reply: vi.fn(async () => false) });
    const input = w.get<HTMLTextAreaElement>('[data-testid="file-annotation-reply-input"]');
    await input.setValue("Fixed.");
    await w.get('[data-testid="file-annotation-reply"]').trigger("click");
    await flushPromises();
    expect(input.element.value).toBe("Fixed.");
  });

  it("sends on Cmd/Ctrl+Enter and leaves a bare Enter as a line break", async () => {
    const { w, reply } = mountPanel();
    const input = w.get('[data-testid="file-annotation-reply-input"]');
    await input.setValue("Fixed.");
    await input.trigger("keydown", { key: "Enter" });
    expect(reply).not.toHaveBeenCalled();
    await input.trigger("keydown", { key: "Enter", metaKey: true });
    expect(reply).toHaveBeenCalledWith("studio:t1", "Fixed.");
  });

  it("asks the pane to reveal, resolve, re-read, and hand threads to the agent", async () => {
    const { w } = mountPanel({ threads: [thread(), thread({ key: "studio:t2", id: "t2" })] });
    await w.get('[data-testid="file-annotation-where"]').trigger("click");
    await w.get('[data-testid="file-annotation-resolve"]').trigger("click");
    await w.get('[data-testid="file-annotation-ask"]').trigger("click");
    await w.get('[data-testid="file-annotations-ask-all"]').trigger("click");
    await w.get('[data-testid="file-annotations-refresh"]').trigger("click");
    expect(w.emitted("reveal")?.[0]).toEqual(["studio:t1"]);
    expect(w.emitted("resolve")?.[0]).toEqual(["studio:t1"]);
    expect(w.emitted("ask")).toEqual([[["studio:t1"]], [["studio:t1", "studio:t2"]]]);
    expect(w.emitted("refresh")).toHaveLength(1);
  });

  it("offers only what the provider and the pane allow", () => {
    const { w } = mountPanel({ threads: [thread({ canReply: false, canResolve: false })], canAsk: false });
    expect(w.find('[data-testid="file-annotation-reply-input"]').exists()).toBe(false);
    expect(w.find('[data-testid="file-annotation-resolve"]').exists()).toBe(false);
    expect(w.find('[data-testid="file-annotation-ask"]').exists()).toBe(false);
  });

  it("says which provider failed and why an action did not land", () => {
    const { w } = mountPanel({ threads: [], failures: [{ label: "Studio", error: "not logged in" }], actionError: "the comment is already resolved" });
    expect(w.get('[data-testid="file-annotations-failure"]').text()).toBe("Studio: not logged in");
    expect(w.get('[data-testid="file-annotations-error"]').text()).toBe("the comment is already resolved");
  });
});
