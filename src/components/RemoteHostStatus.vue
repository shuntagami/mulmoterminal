<script setup lang="ts">
// The phone link's STATE, in the toolbar's status strip. Its controls (connect, disconnect, the
// QR code) are in Settings → Phone link; pressing this opens them there.
//
// Nothing at all for someone who never connected — most people never set the phone link up, and a
// permanent entry for a feature they do not use is what the header redesign took out. It appears
// once a session is parked (they connected), and says the three things that matter: connected,
// reconnecting, or gone. Gone is red, because that is when the phone reaches nothing and someone
// has to act.
//
// This is also the component that keeps the link healing: it is mounted for the life of the app,
// which Settings is not.
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { startRemoteHostSelfHeal, useRemoteHost } from "../composables/useRemoteHost";
import { usePubSub } from "../composables/usePubSub";

const emit = defineEmits<{ (e: "open-settings"): void }>();
const { t } = useI18n();
const { view, alarm, parked, status } = useRemoteHost();

type Shown = { word: string; dot: string; ink: string } | null;
const shown = computed<Shown>(() => {
  if (view.value.online) return { word: t("toolbar.phone.online"), dot: "bg-[#35c46a]", ink: "text-muted" };
  if (!parked.value && !status.value.connected) return null;
  if (view.value.reconnecting) return { word: t("toolbar.phone.reconnecting"), dot: "bg-[#e0a526]", ink: "text-[#e0a526]" };
  if (alarm.value) return { word: t("toolbar.phone.offline"), dot: "bg-[#e0533d]", ink: "text-[#e0533d]" };
  return null;
});

const pubsub = usePubSub();
let stop: (() => void) | null = null;
onMounted(() => (stop = startRemoteHostSelfHeal(pubsub.onReconnect)));
onUnmounted(() => stop?.());
</script>

<template>
  <button
    v-if="shown"
    type="button"
    data-testid="toolbar-phone"
    class="inline-flex flex-none cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 font-sans text-[12px] leading-none hover:underline"
    :class="shown.ink"
    :title="t('toolbar.phone.open')"
    @click="emit('open-settings')"
  >
    <span class="h-2 w-2 rounded-full" :class="shown.dot" aria-hidden="true" />{{ shown.word }}
  </button>
</template>
