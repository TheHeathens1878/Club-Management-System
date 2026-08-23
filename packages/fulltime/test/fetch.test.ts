import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_INTERVAL_MS,
  RateLimiter,
  classifyResponse,
  fetchFullTimePage,
  isChallengeHtml,
  type FetchInitLike,
  type FetchLike,
} from "../src/fetch.ts";
import { fixture } from "./helpers.ts";

const challenge = fixture("ft-results.html");
const league = fixture("ft-league.html");

describe("classifyResponse", () => {
  it("calls the recorded Cloudflare interstitial a challenge, even at HTTP 200", () => {
    expect(classifyResponse(200, challenge)).toBe("challenge");
    expect(isChallengeHtml(challenge)).toBe(true);
  });

  it("does not mistake a real page for a challenge", () => {
    // The real pages carry Cloudflare's bot script too; size is the tell.
    expect(isChallengeHtml(league)).toBe(false);
    expect(classifyResponse(200, league)).toBe("ok");
  });

  it("treats a bare 403 or 429 as a challenge to back off from", () => {
    expect(classifyResponse(403, "")).toBe("challenge");
    expect(classifyResponse(429, "")).toBe("challenge");
  });

  it("distinguishes a missing page from a broken one", () => {
    expect(classifyResponse(404, "<html>gone</html>")).toBe("not_found");
    expect(classifyResponse(500, "<html>oops</html>")).toBe("error");
    expect(classifyResponse(302, "")).toBe("error");
  });
});

describe("fetchFullTimePage", () => {
  it("sends a desktop browser user agent and British English", async () => {
    let seen: FetchInitLike | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      seen = init;
      return { status: 200, text: async () => league };
    };

    const result = await fetchFullTimePage("https://fulltime.thefa.com/index.html?league=1", {
      fetchImpl,
    });

    expect(result.status).toBe(200);
    expect(result.classification).toBe("ok");
    expect(seen?.redirect).toBe("follow");
    expect(seen?.headers?.["User-Agent"]).toMatch(/Chrome\/\d+/);
    expect(seen?.headers?.["Accept-Language"]).toBe("en-GB,en;q=0.9");
  });

  it("classifies a challenge body instead of handing it to the parser", async () => {
    const fetchImpl: FetchLike = async () => ({ status: 200, text: async () => challenge });
    const result = await fetchFullTimePage("https://fulltime.thefa.com/results.html?league=1", {
      fetchImpl,
    });
    expect(result.classification).toBe("challenge");
  });

  it("reports a network failure as an error rather than throwing", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const result = await fetchFullTimePage("https://fulltime.thefa.com/index.html?league=1", {
      fetchImpl,
    });
    expect(result).toMatchObject({ status: 0, html: "", classification: "error" });
    expect(result.error).toContain("ENOTFOUND");
  });

  it("aborts a request that outlives its timeout", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const result = await fetchFullTimePage("https://fulltime.thefa.com/index.html?league=1", {
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result.classification).toBe("error");
  });
});

describe("RateLimiter", () => {
  it("defaults to a five-second gap", () => {
    expect(DEFAULT_MIN_INTERVAL_MS).toBe(5000);
    expect(new RateLimiter().minIntervalMs).toBe(5000);
  });

  it("lets the first call through and spaces the ones after it", async () => {
    let clock = 1_000;
    const slept: number[] = [];
    const limiter = new RateLimiter(5000, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await limiter.wait();
    await limiter.wait();
    clock += 1000;
    await limiter.wait();

    expect(slept).toEqual([5000, 4000]);
  });

  it("queues concurrent callers rather than letting them all go at once", async () => {
    const clock = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(1000, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    await Promise.all([limiter.wait(), limiter.wait(), limiter.wait()]);
    expect(slept).toEqual([1000, 2000]);
  });
});
