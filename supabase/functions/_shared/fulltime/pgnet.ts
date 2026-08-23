/**
 * Fetching a Full-Time URL through Postgres (pg_net) instead of the caller's
 * own HTTP client.
 *
 * Cloudflare in front of fulltime.thefa.com fingerprints the TLS client, not
 * the address: a Deno `fetch()` from an Edge Function is refused (403) with
 * exactly the headers that get libcurl a 200. pg_net is libcurl. So the
 * database issues the request (`fulltime_http_get`, which adds the headers
 * Cloudflare wants — see 20260824140000_fulltime_pgnet_fetch.sql) and the
 * caller polls `fulltime_http_result` for the body.
 *
 * Returns the same {@link FullTimeResponse} shape as {@link fetchFullTimePage}
 * so the classify → parse → import chain does not care which path fetched.
 */

import { classifyResponse, type FullTimeResponse } from "./fetch.ts";

/** The slice of a Supabase client this needs. */
export type RpcClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type PgNetFetchOptions = {
  /** Give up waiting for pg_net after this long. Default 25 s. */
  timeoutMs?: number;
  /** Poll interval. Default 500 ms. */
  pollMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type ResultRow = {
  done: boolean;
  status_code: number | null;
  content: string | null;
  error_msg: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET `url` via `fulltime_http_get` / `fulltime_http_result`. Never throws:
 * a refused request, a pg_net error or a timeout come back as `status: 0`
 * with `error` set and `classification: "error"`.
 */
export async function fetchViaPgNet(
  client: RpcClient,
  url: string,
  opts: PgNetFetchOptions = {},
): Promise<FullTimeResponse> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const pollMs = opts.pollMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());

  const failure = (error: string): FullTimeResponse => ({
    url,
    status: 0,
    html: "",
    classification: "error",
    error,
  });

  const issued = await client.rpc("fulltime_http_get", { p_url: url });
  if (issued.error) return failure(`fulltime_http_get: ${issued.error.message}`);
  const id = issued.data;
  if (typeof id !== "number" && typeof id !== "string") {
    return failure("fulltime_http_get returned no request id");
  }

  const started = now();
  for (;;) {
    const polled = await client.rpc("fulltime_http_result", { p_id: id });
    if (polled.error) return failure(`fulltime_http_result: ${polled.error.message}`);
    const row = (Array.isArray(polled.data) ? polled.data[0] : polled.data) as ResultRow | undefined;
    if (row?.done) {
      if (row.status_code === null) {
        return failure(row.error_msg ?? "pg_net reported no status");
      }
      const html = row.content ?? "";
      return {
        url,
        status: row.status_code,
        html,
        classification: classifyResponse(row.status_code, html),
        ...(row.error_msg ? { error: row.error_msg } : {}),
      };
    }
    if (now() - started >= timeoutMs) return failure(`pg_net did not answer within ${timeoutMs} ms`);
    await sleep(pollMs);
  }
}
