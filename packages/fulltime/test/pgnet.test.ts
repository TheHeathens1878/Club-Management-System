import { describe, expect, it } from "vitest";

import { fetchViaPgNet, type RpcClient } from "../src/pgnet.ts";

type Call = { fn: string; args: Record<string, unknown> | undefined };

function client(script: {
  getResult?: { data: unknown; error: { message: string } | null };
  results: Array<{ data: unknown; error: { message: string } | null }>;
}): { rpc: RpcClient; calls: Call[] } {
  const calls: Call[] = [];
  let polls = 0;
  return {
    calls,
    rpc: {
      rpc(fn, args) {
        calls.push({ fn, args });
        if (fn === "fulltime_http_get") return Promise.resolve(script.getResult ?? { data: 42, error: null });
        const next = script.results[Math.min(polls, script.results.length - 1)];
        polls += 1;
        return Promise.resolve(next ?? { data: [{ done: false }], error: null });
      },
    },
  };
}

const noSleep = { sleep: () => Promise.resolve(), pollMs: 1 };

describe("fetchViaPgNet", () => {
  it("issues the request, polls until done, and classifies the body", async () => {
    const c = client({
      results: [
        { data: [{ done: false, status_code: null, content: null, error_msg: null }], error: null },
        { data: [{ done: true, status_code: 200, content: "<table></table>", error_msg: null }], error: null },
      ],
    });
    const res = await fetchViaPgNet(c.rpc, "https://fulltime.thefa.com/js/cs1.html?cs=1", noSleep);
    expect(res).toMatchObject({ status: 200, html: "<table></table>", classification: "ok" });
    expect(c.calls.map((x) => x.fn)).toEqual(["fulltime_http_get", "fulltime_http_result", "fulltime_http_result"]);
    expect(c.calls[0]?.args).toEqual({ p_url: "https://fulltime.thefa.com/js/cs1.html?cs=1" });
    expect(c.calls[1]?.args).toEqual({ p_id: 42 });
  });

  it("reports a Cloudflare refusal as a challenge", async () => {
    const c = client({
      results: [{ data: [{ done: true, status_code: 403, content: "<title>Just a moment...</title>", error_msg: null }], error: null }],
    });
    const res = await fetchViaPgNet(c.rpc, "https://fulltime.thefa.com/x", noSleep);
    expect(res.classification).toBe("challenge");
    expect(res.status).toBe(403);
  });

  it("never throws: rpc errors, pg_net errors and timeouts become status 0", async () => {
    const refused = await fetchViaPgNet(
      client({ getResult: { data: null, error: { message: "not a Full-Time URL" } }, results: [] }).rpc,
      "https://example.com",
      noSleep,
    );
    expect(refused).toMatchObject({ status: 0, classification: "error" });
    expect(refused.error).toContain("not a Full-Time URL");

    const netError = await fetchViaPgNet(
      client({ results: [{ data: [{ done: true, status_code: null, content: null, error_msg: "Timeout was reached" }], error: null }] }).rpc,
      "https://fulltime.thefa.com/x",
      noSleep,
    );
    expect(netError).toMatchObject({ status: 0, classification: "error", error: "Timeout was reached" });

    let t = 0;
    const slow = await fetchViaPgNet(client({ results: [] }).rpc, "https://fulltime.thefa.com/x", {
      ...noSleep,
      timeoutMs: 100,
      now: () => (t += 60),
    });
    expect(slow.status).toBe(0);
    expect(slow.error).toContain("did not answer");
  });
});

describe("fetchViaPgNet with a prefetched request", () => {
  it("skips fulltime_http_get and reads the given request id", async () => {
    const c = client({
      results: [{ data: [{ done: true, status_code: 200, content: "<table></table>", error_msg: null }], error: null }],
    });
    const res = await fetchViaPgNet(c.rpc, "https://fulltime.thefa.com/js/cs1.html?cs=1", { ...noSleep, requestId: 77 });
    expect(res).toMatchObject({ status: 200, classification: "ok" });
    expect(c.calls.map((x) => x.fn)).toEqual(["fulltime_http_result"]);
    expect(c.calls[0]?.args).toEqual({ p_id: 77 });
  });
});
