"use client";

import { useEffect, useState } from "react";

/**
 * Detects the Job Companion extension via its bridge script on this page. With `poll`, keeps
 * pinging until it answers — Chrome injects the bridge into open tabs only after a reload, so
 * the setup page also reloads itself once the extension appears.
 */
export function useExtension(opts: { poll?: boolean } = {}): { installed: boolean; version: string | null } {
  const [state, setState] = useState<{ installed: boolean; version: string | null }>({ installed: false, version: null });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "jd-extension" || e.data?.type !== "ready") return;
      setState({ installed: true, version: String(e.data.version ?? "") || null });
    };
    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: "jd-app", type: "ping" }, location.origin);
    ping();
    const timer = opts.poll ? setInterval(ping, 2000) : undefined;
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [opts.poll]);
  return state;
}

/** Opens an application tab through the extension so it knows which application to prefill. */
export function openThroughExtension(applicationId: number, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, 3000);
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.data?.source !== "jd-extension" || e.data?.type !== "opened" || e.data?.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(Boolean(e.data.ok));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "jd-app", type: "open-application", applicationId, url, requestId }, location.origin);
  });
}
