/**
 * `@club/fulltime` — everything the platform knows about FA Full-Time.
 *
 * Nothing outside this package should contain a `fulltime.thefa.com` string, a
 * `<td class="home-team">` selector, or an assumption about how the FA formats
 * a date. That containment is the point: PLAN.md §3 Q2 classes Full-Time as an
 * unofficial integration, so when it breaks, it must break here and only here.
 */

export * from "./csv.ts";
export * from "./errors.ts";
export * from "./fetch.ts";
export * from "./html.ts";
export * from "./parse.ts";
export * from "./ref.ts";
export * from "./team.ts";
export * from "./time.ts";
export * from "./types.ts";
export * from "./url.ts";
