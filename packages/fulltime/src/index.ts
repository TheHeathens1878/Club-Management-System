/**
 * `@club/fulltime` — everything the platform knows about FA Full-Time.
 *
 * Nothing outside this package should contain a `fulltime.thefa.com` string, a
 * `<td class="home-team">` selector, or an assumption about how the FA formats
 * a date. That containment is the point: PLAN.md §3 Q2 classes Full-Time as an
 * unofficial integration, so when it breaks, it must break here and only here.
 */

export * from "./csv";
export * from "./errors";
export * from "./fetch";
export * from "./html";
export * from "./parse";
export * from "./ref";
export * from "./team";
export * from "./time";
export * from "./types";
export * from "./url";
