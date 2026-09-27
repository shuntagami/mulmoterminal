<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import RateLimitGauge from "./RateLimitGauge.vue";
import MachineLoadGauge from "./MachineLoadGauge.vue";
import { showLoadAverage } from "../composables/showLoadAverage";
import RemoteHostStatus from "./RemoteHostStatus.vue";
import LauncherButton from "./LauncherButton.vue";
import CommandPalette from "./CommandPalette.vue";
import SortModeMenu from "./SortModeMenu.vue";
import { openCommandPalette, paletteOpen } from "../composables/commandPalette";
import { activeKeymap } from "../composables/activeKeymap";
import { keymapLabelKey } from "./keymapLabels";
import { useI18n } from "vue-i18n";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useShortcuts } from "../composables/useShortcuts";
import { toolbarPinKeys } from "../composables/toolbarPins";
import { collectionChatCount } from "../composables/collectionChatSessions";
import { resolveToolbarPins, toolbarPinKey } from "../../common/toolbarPins";
import type { Shortcut } from "../../common/shortcuts";
import { filesGotoIndex } from "../composables/useFilesView";
import { accountingViewOpen } from "../composables/useAccountingView";
import { wikiGotoIndex, wikiGotoTag } from "../composables/useWikiBrowse";
import { githubGotoIndex } from "../composables/useGithubView";
import { roomsViewOpen } from "../composables/useRoomsView";
import { blueprintsViewOpen } from "../composables/useBlueprintsView";
import { useAppConfig } from "../composables/useAppConfig";
import { worklogEnabled } from "../composables/worklog";
import { listRooms, roomsExist } from "../composables/useRooms";
import { useUpdateStatus } from "../composables/useUpdateStatus";
import { useGithubStar } from "../composables/useGithubStar";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import type { SortMode, StatusCounts } from "./gridTabs";
import { gridStatusSummary } from "./gridTabs";
import { WORKLOG_TAG, screenOf, screensOf, sectionOf, type ToolbarScreen, type ToolbarSection } from "./toolbarSections";
import type { SettingsTabId } from "./settings/settingsTabs";

// The standard header, in two tiers.
//
//   top    — the whole app: which SECTION you are in, what needs you (the status strip), and the
//            app's own tools (commands, notifications, settings). Nothing here depends on where you
//            are, which is why it never changes.
//   bottom — the section you are in: its screens, and what acts on the one showing. The terminal
//            section's creation button leads it; the grid's ordering and view controls end it.
//
// One flat row of equal icons used to hold all of this, and a user could not tell a view switch
// from an action from a status read-out. Every screen here is a route, so what is lit is derived
// from the URL, never held as state.
const props = defineProps<{
  addTerminalActive?: boolean;
  sortMode?: SortMode;
  statusCounts?: StatusCounts;
  // Grid zoom state: the list / thumbnails switch only means something while a cell is enlarged.
  zoomed?: boolean;
  listMode?: boolean;
  // The tiled grid's pages. Shown only when there is more than one and nothing is enlarged —
  // the enlarged views list every cell, not a page of them.
  pages?: number;
  page?: number;
}>();
const emit = defineEmits<{
  (e: "add-terminal"): void;
  (e: "set-sort-mode", mode: SortMode): void;
  (e: "set-list-mode", on: boolean): void;
  (e: "switch-page", page: number): void;
  (e: "settings", tab?: SettingsTabId): void;
}>();
const { t } = useI18n();

const route = useRoute();
const screen = computed<ToolbarScreen>(() => screenOf(String(route.name), route.query.tag));
const section = computed<ToolbarSection>(() => sectionOf(screen.value));
const onGrid = computed(() => screen.value === "grid");

// A tab only for what is set up: PRs with repositories to list, Rooms once a round table has
// written one, the worklog while it is switched on.
const { prRepos } = useAppConfig();
void listRooms();
const screens = computed(() =>
  screensOf(section.value, { prRepos: prRepos.value.length > 0, rooms: roomsExist.value, worklog: worklogEnabled.value }, screen.value),
);
const screenLabel = (s: ToolbarScreen): string => (s === "blueprints" ? t("blueprints.title") : t(`toolbar.screens.${s}`));

function gotoScreen(s: ToolbarScreen): void {
  if (s === "grid") void router.push("/terminals");
  else if (s === "github") githubGotoIndex();
  else if (s === "rooms") roomsViewOpen();
  else if (s === "worklog") wikiGotoTag(WORKLOG_TAG);
  else if (s === "blueprints") blueprintsViewOpen();
  else if (s === "collections") browseGotoIndex("collection");
  else if (s === "feeds") browseGotoIndex("feed");
  else if (s === "wiki") wikiGotoIndex();
  else if (s === "accounting") accountingViewOpen();
  // No cwd: from here the Files view opens on the workspace, where a terminal's own Files opens on
  // that terminal's directory. The route carries the difference (`?cwd=`).
  else filesGotoIndex(null);
}
function gotoSection(s: ToolbarSection): void {
  gotoScreen(s === "terminal" ? "grid" : "collections");
}

// A new terminal always lands in the grid, so from another screen of the section the grid comes
// back first. That is what lets this button keep one place while the tabs beside it change.
async function newTerminal(): Promise<void> {
  if (!onGrid.value) await router.push("/terminals");
  emit("add-terminal");
}

// Grid-wide, at-a-glance tally: how many cells need input / are done / are working, across every
// page — in words, because three coloured dots with bare numbers made everyone hover to learn which
// was which. Shown from every screen: it is the one thing a person reading the wiki still needs to
// know about the terminals.
const summary = computed(() => gridStatusSummary(props.statusCounts));

// The promoted favourites (#1984): the user's own shortcuts ACROSS sections, so they sit on the top
// tier beside the section switch rather than inside one section. The label and the icon come from
// the PIN, never from the config that promoted it.
const { view: browseView } = useCollectionBrowse();
const { shortcuts } = useShortcuts();
const pins = computed(() => resolveToolbarPins(shortcuts.value, toolbarPinKeys.value));
const pinActive = (pin: Shortcut): boolean => browseView.value.mode === "detail" && browseView.value.kind === pin.kind && browseView.value.slug === pin.slug;

// Chats belonging to a collection (#2001), counted on the section they belong to. It is the only
// witness for a chat the grid could not take (#2020), which is why it rides the always-visible tier.
const chatCount = computed(() => collectionChatCount());
const workspaceTitle = computed(() => {
  const name = t("toolbar.sections.workspace");
  if (!chatCount.value) return name;
  const chats = chatCount.value === 1 ? "1 chat" : `${chatCount.value} chats`;
  // "open here", not "running": a chat started as a DRAFT has its prompt typed and not submitted.
  return `${name} — ${chats} open here`;
});

const paletteBinding = computed(() => activeKeymap.value["command-palette"] ?? null);

const { badge: updateBadge } = useUpdateStatus();
const { visible: starVisible, confirming: starConfirming, title: starTitle, activate: activateStar } = useGithubStar();

// Clicking the badge opens a popover that spells out what to run — a silent clipboard copy
// gave no hint of what happened or which command it even was.
const updateRoot = useTemplateRef<HTMLElement>("updateRoot");
const { open: updateOpen, toggle: toggleUpdate } = useDropdownMenu(updateRoot);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

// Copy the command shown in the popover; a brief "Copied" confirms it. Clipboard can be
// unavailable (older browser, insecure context) — then it's a no-op and the command stays on
// screen to copy by hand.
async function copyUpdateCommand(): Promise<void> {
  const command = updateBadge.value?.command;
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    // best-effort — the command is on screen to copy by hand
  }
}

// Top-tier section tabs: filled when current. Bottom-tier screen tabs: underlined. The two tiers
// look different on purpose — they are different kinds of choice.
const sectionClass = (s: ToolbarSection): string =>
  section.value === s ? "bg-selected text-fg font-semibold" : "bg-transparent text-muted font-medium hover:bg-hover hover:text-fg";
const screenClass = (s: ToolbarScreen): string =>
  screen.value === s ? "border-b-accent text-fg font-semibold" : "border-b-transparent text-muted font-medium hover:text-fg";
const pageNumbers = computed(() => Array.from({ length: props.pages ?? 1 }, (_, i) => i));
</script>

<template>
  <header class="relative flex-none border-b border-border">
    <div class="flex h-10 items-center gap-2.5 bg-panel pl-4 pr-3">
      <span class="mr-1.5 flex-none font-sans text-[14px] font-semibold tracking-[0.02em] text-fg">MulmoTerminal</span>
      <nav class="flex flex-none items-center gap-0.5" :aria-label="t('toolbar.sectionsNav')" data-testid="toolbar-sections">
        <button
          type="button"
          data-testid="section-terminal"
          class="h-7 cursor-pointer rounded-md border-0 px-[11px] font-sans text-[13px]"
          :class="sectionClass('terminal')"
          :aria-current="section === 'terminal' ? 'page' : undefined"
          @click="gotoSection('terminal')"
        >
          {{ t("toolbar.sections.terminal") }}
        </button>
        <span class="relative inline-flex flex-none">
          <button
            type="button"
            data-testid="section-workspace"
            class="h-7 cursor-pointer rounded-md border-0 px-[11px] font-sans text-[13px]"
            :class="sectionClass('workspace')"
            :title="workspaceTitle"
            :aria-label="workspaceTitle"
            :aria-current="section === 'workspace' ? 'page' : undefined"
            @click="gotoSection('workspace')"
          >
            {{ t("toolbar.sections.workspace") }}
          </button>
          <span
            v-if="chatCount"
            data-testid="workspace-chat-count"
            class="pointer-events-none absolute -right-1 -top-1 box-border h-[14px] min-w-[14px] rounded-[7px] bg-accent px-[3px] font-sans text-[9px] font-bold leading-[14px] text-on-accent"
            aria-hidden="true"
            >{{ chatCount > 99 ? "99+" : chatCount }}</span
          >
        </span>
      </nav>
      <!-- The promoted favourites. Nothing renders when none is promoted — the empty case leaves
           the header, rule included, exactly as it was. -->
      <span
        v-if="pins.length"
        class="inline-flex flex-none items-center gap-[3px] border-l border-border pl-2.5"
        role="group"
        aria-label="Pinned collections and feeds"
      >
        <LauncherButton
          v-for="pin in pins"
          :key="toolbarPinKey(pin)"
          :icon="pin.icon || 'bookmark'"
          :title="pin.title"
          :label="pin.title"
          :active="pinActive(pin)"
          @click="browseGotoDetail(pin.kind, pin.slug)"
        />
      </span>
      <span class="min-w-0 flex-auto" />
      <!-- Everything here is READ, never pressed (the phone line excepted, which opens its settings).
           It sits between rules so it cannot be mistaken for the buttons on either side. -->
      <div
        class="flex min-w-0 items-center gap-3.5 overflow-hidden whitespace-nowrap border-x border-border px-3.5"
        role="group"
        :aria-label="t('toolbar.status')"
        data-testid="toolbar-status"
      >
        <span v-if="summary.show && statusCounts" class="inline-flex flex-none items-center gap-3 font-sans text-[12px] leading-none" :title="summary.title">
          <span v-if="statusCounts.blocked" class="inline-flex items-center gap-[5px] text-amber">
            <span class="h-2 w-2 rounded-full bg-current" aria-hidden="true" />{{ t("status.attention.blocked") }} {{ statusCounts.blocked }}
          </span>
          <span v-if="statusCounts.working" class="inline-flex items-center gap-[5px] text-muted">
            <span class="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />{{ t("status.attention.working") }} {{ statusCounts.working }}
          </span>
          <!-- --ok rather than --done: this tally is INK on the toolbar, and --done is a fill colour
               that reads at 2.3:1 on a white panel. -->
          <span v-if="statusCounts.done" class="inline-flex items-center gap-[5px] text-ok">
            <span class="h-2 w-2 rounded-full bg-current" aria-hidden="true" />{{ t("status.attention.done") }} {{ statusCounts.done }}
          </span>
        </span>
        <RateLimitGauge />
        <MachineLoadGauge v-if="showLoadAverage" />
        <RemoteHostStatus @open-settings="emit('settings', 'phone')" />
      </div>
      <div v-if="updateBadge" ref="updateRoot" class="relative flex-none">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-[12px] leading-none text-accent hover:bg-selected"
          :class="{ 'bg-selected': updateOpen }"
          :title="updateBadge.text"
          :aria-label="updateBadge.text"
          :aria-expanded="updateOpen"
          aria-haspopup="true"
          @click="toggleUpdate"
        >
          <span class="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">upgrade</span>
          Update
        </button>
        <div
          v-if="updateOpen"
          class="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-panel p-3 text-[13px] text-fg shadow-lg"
          role="group"
          aria-label="Update available"
        >
          <p class="mb-2 font-semibold">A newer version is available</p>
          <template v-if="updateBadge.command">
            <p class="mb-1 text-muted">Run this to update:</p>
            <div class="flex items-center gap-2">
              <code class="min-w-0 flex-1 overflow-x-auto rounded bg-selected px-2 py-1 font-mono text-[12px] whitespace-nowrap">{{
                updateBadge.command
              }}</code>
              <button type="button" class="flex-none rounded border border-border px-2 py-1 text-[12px] hover:bg-selected" @click="copyUpdateCommand">
                {{ copied ? "Copied" : "Copy" }}
              </button>
            </div>
          </template>
          <p v-else class="text-muted">{{ updateBadge.text }}</p>
        </div>
      </div>
      <!-- Star this project on GitHub. It retires itself once starred (or once the user has opened
           the repo page), so it is a one-time ask rather than a fixture. -->
      <LauncherButton v-if="starVisible" icon="star" :title="starTitle" :label="starTitle" :active="starConfirming" @click="activateStar" />
      <!-- A button, not a field: the palette is a dialog that opens at the top centre, as dialogs do,
           and a box drawn as a field would promise typing where it sits. It is named by the palette's
           own word for what it lists, and shows the key, which is half of what the palette teaches. -->
      <button
        type="button"
        data-testid="toolbar-commands"
        class="inline-flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 font-sans text-[13px] text-muted hover:bg-hover hover:text-fg"
        :title="t(keymapLabelKey('command-palette'))"
        @click="openCommandPalette"
      >
        {{ t("commandPalette.open") }}
        <span v-if="paletteBinding" class="rounded border border-border px-[5px] py-px font-mono text-[11px] text-dim" aria-hidden="true">{{
          paletteBinding
        }}</span>
      </button>
      <NotificationBell />
      <LauncherButton icon="settings" title="Settings" label="Settings" @click="emit('settings')" />
    </div>

    <div class="flex h-[38px] items-stretch bg-base px-3" data-testid="toolbar-section-bar">
      <!-- Creation leads the section, where reading starts — the place "New" has in most apps, and
           across the screen from every cell's close button. Before the tabs rather than after them,
           so it never moves when a tab appears or goes. -->
      <div v-if="section === 'terminal'" class="mr-2 flex flex-none items-center border-r border-border pr-3">
        <button
          type="button"
          data-testid="toolbar-new-terminal"
          class="inline-flex h-[26px] cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border-0 pl-1.5 pr-2.5 font-sans text-[12px] font-semibold text-on-accent hover:bg-accent-bg-hover"
          :class="addTerminalActive ? 'bg-accent-bg-hover' : 'bg-accent-bg'"
          :aria-pressed="addTerminalActive"
          :title="addTerminalActive ? t('toolbar.closeLaunchPanel') : t('toolbar.newTerminal')"
          @click="newTerminal"
        >
          <span class="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">add</span>{{ t("toolbar.newTerminal") }}
        </button>
      </div>
      <nav class="flex min-w-0 items-stretch gap-1 overflow-x-auto" :aria-label="t('toolbar.screensNav')" data-testid="toolbar-screens">
        <button
          v-for="s in screens"
          :key="s"
          type="button"
          :data-testid="`screen-${s}`"
          class="flex-none cursor-pointer whitespace-nowrap border-0 border-b-2 bg-transparent px-[9px] font-sans text-[13px]"
          :class="screenClass(s)"
          :aria-current="screen === s ? 'page' : undefined"
          @click="gotoScreen(s)"
        >
          {{ screenLabel(s) }}
        </button>
      </nav>
      <span class="min-w-0 flex-auto" />
      <!-- The grid's own controls, only while the grid is the screen: they act on cells nobody can see
           under another screen. -->
      <div v-if="onGrid" class="flex flex-none items-center gap-2.5">
        <nav v-if="(pages ?? 1) > 1 && !zoomed" class="flex items-center gap-1" :aria-label="t('toolbar.pages')" data-testid="toolbar-pages">
          <button
            v-for="p in pageNumbers"
            :key="p"
            type="button"
            class="min-w-[26px] cursor-pointer rounded-md border border-border bg-base px-2 py-[3px] font-mono text-[12px] text-muted hover:bg-hover hover:text-fg aria-pressed:border-accent aria-pressed:bg-hover aria-pressed:text-fg"
            :aria-pressed="p === page"
            :aria-label="t('toolbar.page', { n: p + 1 })"
            @click="emit('switch-page', p)"
          >
            {{ p + 1 }}
          </button>
        </nav>
        <SortModeMenu :mode="sortMode ?? 'auto'" @select="emit('set-sort-mode', $event)" />
        <template v-if="zoomed">
          <span class="font-sans text-[12px] text-dim">{{ t("toolbar.view.label") }}</span>
          <div class="flex overflow-hidden rounded-md border border-border" role="group" :aria-label="t('toolbar.view.label')" data-testid="toolbar-view">
            <button
              type="button"
              class="h-6 cursor-pointer border-0 px-[9px] font-sans text-[12px]"
              :class="listMode ? 'bg-selected font-semibold text-fg' : 'bg-transparent text-muted hover:text-fg'"
              :aria-pressed="!!listMode"
              @click="emit('set-list-mode', true)"
            >
              {{ t("toolbar.view.list") }}
            </button>
            <button
              type="button"
              class="h-6 cursor-pointer border-0 px-[9px] font-sans text-[12px]"
              :class="!listMode ? 'bg-selected font-semibold text-fg' : 'bg-transparent text-muted hover:text-fg'"
              :aria-pressed="!listMode"
              @click="emit('set-list-mode', false)"
            >
              {{ t("toolbar.view.strip") }}
            </button>
          </div>
        </template>
      </div>
    </div>
    <CommandPalette v-if="paletteOpen" />
  </header>
</template>
