// The remote-host command channel: drive MulmoTerminal from a phone (the mulmoserver PWA) over
// Firestore.
//
// Module-level state, because two places read it: the toolbar's status line (always mounted, and
// the one that keeps the link healing) and Settings → Phone (where you connect, disconnect and get
// the QR code). Before the header redesign both lived in one toolbar popover; the popover was a
// permanent icon for a control pressed once, so the controls moved to Settings and only the state
// stayed where it can be seen.
//
// Google sign-in popup (browser Firebase) → extract the Google OAuth idToken → POST it to
// /api/remote-host/connect, where the server signs in as the user and starts the Firestore command
// loop + presence heartbeat.
import { computed, ref } from "vue";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { auth } from "../config/firebase";
// Session parking (localStorage) + reconnect-outcome decision live in a plain module so they're
// unit-testable without importing Firebase.
import {
  healthOrFallback,
  loadStoredSession,
  persistSession,
  reconnectAction,
  type FetchResult,
  type RemoteHostStatus,
  isRemoteHostStatus,
} from "../components/remoteHostSession";
import { registerRemoteHostSelfHeal } from "../components/remoteHostSelfHeal";
import { remoteHostAlarm, remoteHostView } from "../components/remoteHostView";
import type { RunnerHealth } from "../../common/remoteHostHealth";
import { isRecord } from "../../common/isRecord";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const health = ref<RunnerHealth>({ state: "offline", lastError: null, changedAt: 0 });
// Every ref above starts at its disconnected default, so nothing may raise alarm until the
// server has actually answered once.
const loaded = ref(false);
// Mirrors the parked blob rather than reading localStorage per render — Vue cannot observe
// storage, so a computed over it would answer with whatever was true at the first render and
// keep the alarm on after a Disconnect. Every write goes through rememberSession below.
const parked = ref(loadStoredSession() !== null);

function rememberSession(blob: string | null): void {
  persistSession(blob);
  parked.value = blob !== null;
}

// "Online" only while the channel is actually subscribed — a runner re-subscribing after
// an outage says so, instead of showing green while the phone still can't reach us (#823).
const view = computed(() => remoteHostView(status.value.connected, health.value.state));
const isReconnecting = computed(() => view.value.reconnecting);
// Offline that someone has to act on: they connected once and the link is gone.
const alarm = computed(() => remoteHostAlarm(view.value, parked.value, loaded.value));

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function fetchStatus(url: string, method: "GET" | "POST", body?: unknown): Promise<FetchResult> {
  try {
    // RequestInit spells its fields exact, and `body: undefined` is not the same as no body —
    // so a GET here has to omit both keys rather than send them empty.
    const res = await fetchWithTimeout(
      url,
      {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (!res.ok) {
      const detail = await jsonBody(res);
      return { ok: false, error: typeof detail.error === "string" && detail.error ? detail.error : `HTTP ${res.status}`, httpStatus: res.status };
    }
    const data: unknown = await res.json();
    const statusValue = isRecord(data) ? data.status : undefined;
    if (!isRemoteHostStatus(statusValue)) return { ok: false, error: "malformed remote-host status", httpStatus: res.status };
    const session = isRecord(data) ? data.session : null;
    const healthValue = isRecord(data) ? data.health : undefined;
    return {
      ok: true,
      status: statusValue,
      session: typeof session === "string" ? session : null,
      health: healthOrFallback(healthValue, statusValue.connected),
    };
  } catch (err) {
    return { ok: false, error: errorText(err), httpStatus: 0 };
  }
}

function applyOk(result: Extract<FetchResult, { ok: true }>): void {
  status.value = result.status;
  health.value = result.health;
  loaded.value = true;
}

async function refreshStatus(): Promise<void> {
  const result = await fetchStatus("/api/remote-host/status", "GET");
  if (result.ok) {
    applyOk(result);
    // Keep the parked blob fresh (the refresh token can rotate) — but never clear
    // it on a disconnected status, so an auto-reconnect still has it.
    if (result.session) rememberSession(result.session);
    error.value = null;
  } else {
    error.value = result.error;
  }
}

// On load, if the server is disconnected but we have a parked session, restore it
// without a popup. A 401 means the blob is genuinely expired/invalid → drop it;
// transient failures KEEP it so a later retry/restart can still reconnect.
async function tryAutoReconnect(): Promise<void> {
  if (status.value.connected) return;
  // The server re-subscribes on its own for a while; replaying the blob meanwhile would
  // tear down a session that is still healing and open a fresh Firebase app each poll.
  if (isReconnecting.value) return;
  const blob = loadStoredSession();
  if (!blob) return;
  const res = await fetchStatus("/api/remote-host/reconnect", "POST", { session: blob });
  if (res.ok) applyOk(res);
  const action = reconnectAction(res);
  if (action === "park" && res.ok) rememberSession(res.session);
  else if (action === "drop") rememberSession(null);
}

async function connect(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
    if (!idToken) {
      error.value = "Could not obtain a Google sign-in token.";
      return;
    }
    const res = await fetchStatus("/api/remote-host/connect", "POST", { idToken });
    if (!res.ok) {
      error.value = res.error;
      return;
    }
    applyOk(res);
    rememberSession(res.session); // park the session for popup-free reconnect after a restart
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  busy.value = true;
  error.value = null;
  const res = await fetchStatus("/api/remote-host/disconnect", "POST");
  if (res.ok) {
    applyOk(res);
    rememberSession(null); // forget the parked session on an explicit disconnect
  } else {
    error.value = res.error;
  }
  busy.value = false;
}

// Re-check the real connection state and, if the server dropped our parked session
// (e.g. it restarted while this tab stayed open), re-push it popup-free.
function selfHeal(): Promise<void> {
  return refreshStatus()
    .then(tryAutoReconnect)
    .catch(() => undefined);
}

/** Heal once now, then on every signal that means the server may have come back or we returned to
 *  the tab — without this a server restart leaves the UI showing "connected" while every Web Push
 *  silently no-ops. Returns the stop function. Called by the one component that is always mounted
 *  (the toolbar's status line); Settings only reads. */
export function startRemoteHostSelfHeal(onReconnect: Parameters<typeof registerRemoteHostSelfHeal>[1]): () => void {
  void selfHeal();
  return registerRemoteHostSelfHeal(() => void selfHeal(), onReconnect);
}

export function useRemoteHost() {
  return { busy, error, status, health, loaded, parked, view, alarm, refreshStatus, connect, disconnect };
}
