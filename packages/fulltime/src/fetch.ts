/**
 * Fetching Full-Time pages politely, and noticing when we have been stopped.
 *
 * fulltime.thefa.com sits behind Cloudflare. A browser-shaped request gets a
 * few pages and then an interstitial: either HTTP 403, or — more dangerously —
 * HTTP 200 whose body is the "Just a moment..." challenge. A naive importer
 * parses that 200 as a page, finds no rows, and concludes the team has no
 * fixtures. {@link classifyResponse} exists so that never happens: a challenge
 * is a distinct outcome from an empty page, and P2.4's "import failures alert
 * admin" hangs off telling them apart.
 *
 * There is no retry loop in here on purpose. Retrying into a challenge is how
 * an IP gets blocked; the caller backs off, and {@link RateLimiter} keeps the
 * happy path slow enough not to trigger one in the first place.
 */

/** The politeness floor between two Full-Time requests, in milliseconds. */
export const DEFAULT_MIN_INTERVAL_MS = 5000;

/** A current desktop Chrome UA. Full-Time serves bots a challenge immediately. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const DEFAULT_TIMEOUT_MS = 20_000;

/** How a response should be treated. */
export type ResponseClassification = "ok" | "challenge" | "not_found" | "error";

/**
 * The parts of `Response` this package uses. Declared structurally so tests can
 * pass a plain object and so the package does not depend on DOM or undici
 * types — it has to run in Node and in an Edge Function alike.
 */
export type FetchResponseLike = {
  status: number;
  url?: string;
  text(): Promise<string>;
};

export type FetchInitLike = {
  method?: string;
  headers?: Record<string, string>;
  redirect?: "follow" | "manual" | "error";
  signal?: AbortSignal;
};

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export type FetchFullTimeOptions = {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  userAgent?: string;
  timeoutMs?: number;
  /** Extra request headers, merged over the defaults. */
  headers?: Record<string, string>;
};

export type FullTimeResponse = {
  /** The URL requested, or the final one after redirects when known. */
  url: string;
  /** HTTP status, or `0` when the request never completed. */
  status: number;
  html: string;
  classification: ResponseClassification;
  /** Set when the request failed outright (network error, timeout). */
  error?: string;
};

/** Markers that only ever appear on an interstitial. */
const CHALLENGE_MARKERS: readonly RegExp[] = [
  /<title>\s*just a moment/i,
  /challenges\.cloudflare\.com/i,
  /\bcf[-_]chl\b/i,
  /_cf_chl_/i,
];

/**
 * Markers that also appear on a perfectly good page — the recorded snapshots in
 * `test/fixtures/` all carry Cloudflare's `cdn-cgi/challenge-platform` bot
 * script — so they only count against a document too small to be a real one.
 */
const WEAK_CHALLENGE_MARKERS: readonly RegExp[] = [
  /cdn-cgi\/challenge-platform/i,
  /enable javascript and cookies to continue/i,
];

/**
 * A Full-Time page is well over 100 KB; the interstitial is about 6 KB. Nothing
 * useful comes back under this size.
 */
const MAX_CHALLENGE_BYTES = 50_000;

/** True when a body is a Cloudflare interstitial rather than a Full-Time page. */
export function isChallengeHtml(html: string): boolean {
  if (html === "") return false;
  if (CHALLENGE_MARKERS.some((marker) => marker.test(html))) return true;
  return (
    html.length <= MAX_CHALLENGE_BYTES &&
    WEAK_CHALLENGE_MARKERS.some((marker) => marker.test(html))
  );
}

/**
 * What to do with a response.
 *
 * A challenge is reported as a challenge whatever the status code, because
 * Cloudflare serves it as both 403 and 200 and the body is the only reliable
 * tell.
 */
export function classifyResponse(status: number, html: string): ResponseClassification {
  if (isChallengeHtml(html)) return "challenge";
  if (status === 403 || status === 429) return "challenge";
  if (status === 404 || status === 410) return "not_found";
  if (status >= 200 && status < 300) return "ok";
  return "error";
}

/**
 * Fetch one Full-Time page.
 *
 * Never retries and never throws for an HTTP-level problem: the caller decides
 * whether a `challenge` means "wait five minutes" or "tell the admin the
 * import is broken".
 */
export async function fetchFullTimePage(
  url: string,
  options: FetchFullTimeOptions = {},
): Promise<FullTimeResponse> {
  const {
    fetchImpl = globalThis.fetch as unknown as FetchLike | undefined,
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
  } = options;

  if (typeof fetchImpl !== "function") {
    return {
      url,
      status: 0,
      html: "",
      classification: "error",
      error: "No fetch implementation available.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        ...headers,
      },
    });
    const html = await response.text();
    return {
      url: response.url ?? url,
      status: response.status,
      html,
      classification: classifyResponse(response.status, html),
    };
  } catch (cause) {
    return {
      url,
      status: 0,
      html: "",
      classification: "error",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    clearTimeout(timer);
  }
}

type Clock = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Spaces awaited calls at least `minIntervalMs` apart.
 *
 * Concurrent callers queue rather than all going at once, so a loop over a
 * club's teams stays polite even if it forgets to await in order.
 */
export class RateLimiter {
  readonly minIntervalMs: number;
  private nextAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS, clock: Clock = {}) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this.now = clock.now ?? (() => Date.now());
    this.sleep =
      clock.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** Resolves when it is polite to make the next request. */
  async wait(): Promise<void> {
    const now = this.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.minIntervalMs;
    const delay = at - now;
    if (delay > 0) await this.sleep(delay);
  }
}
