/** Small counting semaphore. */
export class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private slots: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.slots > 0) this.slots--;
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.slots++;
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const hostLimiters = new Map<string, Semaphore>();
let perHostLimit = 4;

export function setPerHostConcurrency(n: number): void {
  if (n !== perHostLimit) hostLimiters.clear();
  perHostLimit = n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UA = "job-discovery/0.1 (personal use)";

/** GET/POST with a per-host concurrency cap and jittered backoff on 429/5xx/network errors. */
async function request(url: string, accept: string, init: RequestInit, retries: number): Promise<Response> {
  const host = new URL(url).host;
  let limiter = hostLimiters.get(host);
  if (!limiter) hostLimiters.set(host, (limiter = new Semaphore(perHostLimit)));

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await limiter.run(() =>
        fetch(url, {
          ...init,
          headers: { accept, "user-agent": UA, ...init.headers },
          signal: AbortSignal.timeout(30_000),
        }),
      );
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError || attempt >= retries) throw err;
    }
    await sleep(500 * 2 ** attempt + Math.random() * 400);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, retries = 3): Promise<T> {
  return (await (await request(url, "application/json", init, retries)).json()) as T;
}

/** POSTs a JSON body and reads a JSON response. Used by Workday, whose list endpoint is a POST. */
export function postJson<T>(url: string, body: unknown, retries = 3): Promise<T> {
  return fetchJson<T>(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, retries);
}

/** Fetches a web page as text, capped so a huge page can't be read into memory. */
export async function fetchText(url: string, maxBytes = 8_000_000, retries = 1): Promise<{ url: string; body: string }> {
  const res = await request(url, "text/html,application/xhtml+xml", { redirect: "follow" }, retries);
  const buf = await res.arrayBuffer();
  return { url: res.url || url, body: new TextDecoder().decode(buf.slice(0, maxBytes)) };
}
