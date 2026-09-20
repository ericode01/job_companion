/**
 * Runs on the Job Companion app. Pairs the extension (same-origin token fetch) and lets the
 * app open application tabs that the extension knows how to prefill.
 */
import type { Msg } from "./messages";

const APP = "jd-app";
const EXT = "jd-extension";

async function pair() {
  try {
    // Pairs with whoever is signed in; signing in as someone else re-pairs on their next page load.
    const res = await fetch("/api/extension/token", { credentials: "same-origin" });
    if (!res.ok) return;
    const { token } = (await res.json()) as { token: string };
    await chrome.runtime.sendMessage({ type: "pair", token } satisfies Msg);
  } catch {
    /* app not ready; retried on next page load */
  }
}

function announce() {
  window.postMessage({ source: EXT, type: "ready", version: __VERSION__ }, location.origin);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { source?: string; type?: string; applicationId?: number; url?: string; requestId?: string };
  if (data?.source !== APP) return;
  if (data.type === "ping") announce();
  if (data.type === "open-application" && typeof data.applicationId === "number" && typeof data.url === "string") {
    const reply = await chrome.runtime.sendMessage({ type: "open-application", applicationId: data.applicationId, url: data.url } satisfies Msg);
    window.postMessage({ source: EXT, type: "opened", requestId: data.requestId, ok: reply?.ok ?? false, error: reply?.ok ? undefined : reply?.error }, location.origin);
  }
});

void pair();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce);
else announce();
