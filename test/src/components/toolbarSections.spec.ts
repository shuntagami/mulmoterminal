import { describe, it, expect } from "vitest";
import { screenOf, sectionOf, terminalScreens, TERMINAL_SCREENS, WORKSPACE_SCREENS } from "../../../src/components/toolbarSections";
import { routes } from "../../../src/router/index";

const none = { prRepos: false, rooms: false, worklog: false };
const all = { prRepos: true, rooms: true, worklog: true };

describe("screenOf", () => {
  it("names the screen of every route the app has", () => {
    const named = routes.map((r) => r.name).filter((n): n is string => typeof n === "string");
    for (const name of named) expect([...TERMINAL_SCREENS, ...WORKSPACE_SCREENS]).toContain(screenOf(name, undefined));
  });

  // The worklog is the wiki filtered to its tag, and it belongs with the terminals it records.
  it("moves the worklog-tagged wiki to the terminal section", () => {
    expect(screenOf("wiki", "worklog")).toBe("worklog");
    expect(screenOf("wiki", ["design", "worklog"])).toBe("worklog");
    expect(screenOf("wiki", "design")).toBe("wiki");
    expect(sectionOf(screenOf("wiki", "worklog"))).toBe("terminal");
    expect(sectionOf(screenOf("wiki", undefined))).toBe("workspace");
  });

  // A Map, so a name nobody registered cannot answer through Object's prototype.
  it("falls back to the grid for a name it does not know", () => {
    expect(screenOf("constructor", undefined)).toBe("grid");
    expect(screenOf("nowhere", undefined)).toBe("grid");
  });
});

describe("terminalScreens", () => {
  it("offers only what needs no setup when nothing is set up", () => {
    expect(terminalScreens(none, "grid")).toEqual(["grid", "blueprints"]);
  });

  it("offers everything, in order, when everything is set up", () => {
    expect(terminalScreens(all, "grid")).toEqual(["grid", "github", "rooms", "worklog", "blueprints"]);
  });

  it("always offers the screen you are on", () => {
    expect(terminalScreens(none, "github")).toEqual(["grid", "github", "blueprints"]);
  });
});
