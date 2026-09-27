<script setup lang="ts">
// Settings → Phone link: connect this MulmoTerminal to the phone companion (the mulmoserver PWA),
// disconnect it, and hand the phone the address. This used to be a popover behind a permanent
// toolbar icon — a control pressed once, sitting in the row everyone scans all day. The STATE of
// the link stayed on the toolbar (RemoteHostStatus), which is the part worth seeing.
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { renderSVG } from "uqr";
import { useRemoteHost } from "../../composables/useRemoteHost";
import { MULMOSERVER_ORIGIN } from "../../../common/firebaseConfig";

const { t } = useI18n();
const { busy, error, status, health, view, refreshStatus, connect, disconnect } = useRemoteHost();

// Rendered to a data URL (uqr output is ASCII-only SVG) so no v-html is needed.
const qrDataUrl = `data:image/svg+xml;base64,${btoa(renderSVG(MULMOSERVER_ORIGIN))}`;

// Opening the pane is the moment someone asks "is it connected?", so ask the server rather than
// showing whatever the last poll said.
onMounted(() => {
  refreshStatus().catch(() => undefined);
});

const stateWord = (): string => {
  if (view.value.online) return t("settings.phone.online");
  if (view.value.reconnecting) return t("settings.phone.reconnecting");
  return t("settings.phone.offline");
};
</script>

<template>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">{{ t("settings.phone.intro") }}</p>
  <div class="flex max-w-[360px] flex-col gap-2">
    <div class="flex items-center gap-1.5" data-testid="phone-state">
      <span class="material-symbols-outlined text-[16px] leading-none" :class="view.toneClass" aria-hidden="true">{{ view.icon }}</span>
      <span class="text-[12px] font-semibold text-fg">{{ stateWord() }}</span>
    </div>
    <p v-if="status.uid" class="font-mono text-[10px] text-muted [overflow-wrap:anywhere]">{{ t("settings.phone.signedInAs", { uid: status.uid }) }}</p>
    <p v-if="health.lastError && health.state !== 'online'" class="text-[11px] leading-[1.4] text-[#e0a526] [overflow-wrap:anywhere]">
      {{ t("settings.phone.lastError", { error: health.lastError }) }}
    </p>
    <button
      v-if="!status.connected"
      type="button"
      data-testid="phone-connect"
      class="inline-flex h-8 w-fit cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-accent-bg px-2.5 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="busy"
      @click="connect"
    >
      <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">login</span>
      {{ busy ? t("settings.phone.connecting") : t("settings.phone.connect") }}
    </button>
    <button
      v-else
      type="button"
      data-testid="phone-disconnect"
      class="inline-flex h-8 w-fit cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-[12px] font-medium text-fg enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="busy"
      @click="disconnect"
    >
      <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">logout</span>
      {{ busy ? t("settings.phone.disconnecting") : t("settings.phone.disconnect") }}
    </button>
    <p v-if="error" class="text-[11px] text-[#e0533d] [overflow-wrap:anywhere]">{{ error }}</p>
    <div class="mt-1 flex flex-col gap-1.5 border-t border-border pt-2.5 text-[11px] leading-[1.4] text-muted">
      <p>{{ t("settings.phone.openOnPhone") }}</p>
      <a :href="MULMOSERVER_ORIGIN" target="_blank" rel="noopener noreferrer" class="font-mono text-[#6ea8fe] [overflow-wrap:anywhere]">{{
        MULMOSERVER_ORIGIN
      }}</a>
      <img :src="qrDataUrl" alt="" aria-hidden="true" class="mt-1 h-32 w-32 rounded-md" />
      <p>{{ t("settings.phone.scan") }}</p>
    </div>
  </div>
</template>
