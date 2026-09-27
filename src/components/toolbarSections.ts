// The toolbar's two tiers: the top one picks a SECTION, the one under it picks a SCREEN inside that
// section and holds what acts on it. Split out of AppToolbar.vue so the grouping — which is the
// whole point of the design — is a spec rather than something read off a template.
//
// Why two sections and not one flat row: the grid is where a terminal user lives, Collections is a
// door into five content surfaces, and PRs / Rooms are single screens that exist because of the
// terminals. A flat row presented those three levels as peers. The code already grouped them this
// way (CONTENT_ROUTES on one side, the grid's own overlays on the other); this makes it visible.
import { parseTagQuery } from "./wikiTagFilter";

export type ToolbarSection = "terminal" | "workspace";
export type TerminalScreen = "grid" | "github" | "rooms" | "worklog" | "blueprints";
export type WorkspaceScreen = "collections" | "feeds" | "wiki" | "accounting" | "files";
export type ToolbarScreen = TerminalScreen | WorkspaceScreen;

// The wiki tag the scheduled worklog writes its weekly pages under.
export const WORKLOG_TAG = "worklog";

export const TERMINAL_SCREENS: readonly TerminalScreen[] = ["grid", "github", "rooms", "worklog", "blueprints"];
export const WORKSPACE_SCREENS: readonly WorkspaceScreen[] = ["collections", "feeds", "wiki", "accounting", "files"];

// A Map rather than an object literal: the key is a route name, and an object would answer
// `constructor` through its prototype for a name nobody registered.
const SCREEN_BY_ROUTE = new Map<string, ToolbarScreen>([
  ["terminals", "grid"],
  ["github", "github"],
  ["rooms", "rooms"],
  ["roomView", "rooms"],
  ["blueprints", "blueprints"],
  ["blueprintMarket", "blueprints"],
  ["blueprintRun", "blueprints"],
  ["collections", "collections"],
  ["collectionDetail", "collections"],
  ["feeds", "feeds"],
  ["feedDetail", "feeds"],
  ["wiki", "wiki"],
  ["wikiPage", "wiki"],
  ["wikiGraph", "wiki"],
  ["wikiLint", "wiki"],
  ["accounting", "accounting"],
  ["files", "files"],
]);

/** Which screen a route is. The worklog is the wiki index filtered to its tag, and it counts as the
 *  terminals' own record rather than as workspace content, so that one query moves it across. */
export function screenOf(routeName: string, tagQuery: unknown): ToolbarScreen {
  if (routeName === "wiki" && parseTagQuery(tagQuery).has(WORKLOG_TAG)) return "worklog";
  return SCREEN_BY_ROUTE.get(routeName) ?? "grid";
}

export const sectionOf = (screen: ToolbarScreen): ToolbarSection => (TERMINAL_SCREENS.some((s) => s === screen) ? "terminal" : "workspace");

/** What decides whether a terminal screen has anything behind it. */
export interface ScreenAvailability {
  /** Any repository configured for the PRs & Issues view. */
  prRepos: boolean;
  /** At least one conversation room exists. */
  rooms: boolean;
  /** The scheduled worklog is switched on. */
  worklog: boolean;
}

const availableIn = (screen: TerminalScreen, a: ScreenAvailability): boolean => {
  if (screen === "github") return a.prRepos;
  if (screen === "rooms") return a.rooms;
  if (screen === "worklog") return a.worklog;
  return true;
};

/** The terminal screens to offer. A feature nobody has set up gets no tab: PRs with no repository,
 *  Rooms before any round table, the worklog while it is off would each open onto an empty view.
 *  The screen you are ON is always offered, so a direct link never leaves nothing lit. */
export const terminalScreens = (a: ScreenAvailability, current: ToolbarScreen): TerminalScreen[] =>
  TERMINAL_SCREENS.filter((screen) => screen === current || availableIn(screen, a));

/** The screens of a section, in order. */
export const screensOf = (section: ToolbarSection, a: ScreenAvailability, current: ToolbarScreen): readonly ToolbarScreen[] =>
  section === "terminal" ? terminalScreens(a, current) : WORKSPACE_SCREENS;
