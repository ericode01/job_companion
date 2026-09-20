import type { Msg, Reply, StatusInfo } from "./messages";

/** The Job Companion server this build was made for (see build.mjs). */
const APP_ORIGINS: string[] = __APP_ORIGINS__;
const API = APP_ORIGINS[0]!;
const fromApp = (url: string | undefined) => Boolean(url && APP_ORIGINS.some((o) => url.startsWith(`${o}/`)));

async function getToken(): Promise<string | null> {
  const { token } = await chrome.storage.local.get("token");
  return (token as string | undefined) ?? null;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error(`Not connected yet. Sign in to Job Companion (${API}) in this browser once.`);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-jd-token": token, "x-jd-version": __VERSION__, ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error(`Can't reach Job Companion at ${API}. Check your connection.`);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const tabKey = (tabId: number) => `tab:${tabId}`;

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case "pair": {
      // Only the bridge script on the app itself can pair.
      if (!fromApp(sender.url)) throw new Error("Pairing refused");
      await chrome.storage.local.set({ token: msg.token });
      return true;
    }
    case "open-application": {
      if (!fromApp(sender.url)) throw new Error("Refused");
      const url = new URL(msg.url);
      if (url.protocol !== "https:") throw new Error("Only https application links can be opened");
      const tab = await chrome.tabs.create({ url: url.toString(), index: sender.tab ? sender.tab.index + 1 : undefined });
      if (tab.id !== undefined) await chrome.storage.session.set({ [tabKey(tab.id)]: msg.applicationId });
      return { tabId: tab.id };
    }
    case "status": {
      const paired = Boolean(await getToken());
      let appReachable = false;
      try {
        appReachable = (await fetch(`${API}/api/health`, { method: "GET" })).ok;
      } catch {
        appReachable = false;
      }
      return { paired, appReachable } satisfies StatusInfo;
    }
    case "get-application": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return null;
      const stored = await chrome.storage.session.get(tabKey(tabId));
      return (stored[tabKey(tabId)] as number | undefined) ?? null;
    }
    case "match": {
      const { match } = await api<{ match: { applicationId: number } | null }>("/api/extension/match", { method: "POST", body: JSON.stringify({ url: msg.url }) });
      if (match && sender.tab?.id !== undefined) await chrome.storage.session.set({ [tabKey(sender.tab.id)]: match.applicationId });
      return match?.applicationId ?? null;
    }
    case "packet":
      return api(`/api/extension/packet?applicationId=${msg.applicationId}`);
    case "answers":
      return api("/api/extension/answers", { method: "POST", body: JSON.stringify({ applicationId: msg.applicationId, questions: msg.questions }) });
    case "save-answer": {
      const { type: _t, ...body } = msg;
      return api("/api/extension/save-answer", { method: "POST", body: JSON.stringify(body) });
    }
    case "submitted":
      return api("/api/extension/submitted", { method: "POST", body: JSON.stringify({ applicationId: msg.applicationId, answers: msg.answers }) });
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies Reply<unknown>))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply<unknown>));
  return true; // async response
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(tabKey(tabId));
});

/*
 * Content scripts only reach tabs opened after install, so the app's "Set up the extension"
 * page (already open) would never hear from us. Inject the bridge into open app tabs once, so
 * that page turns green the moment Chrome loads the extension.
 */
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: APP_ORIGINS.map((o) => `${o}/*`) });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => {});
  }
});
