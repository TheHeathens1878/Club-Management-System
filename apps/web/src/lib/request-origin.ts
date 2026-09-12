import { headers } from "next/headers";

/**
 * The origin the CURRENT request came in on — `https://portal.aomsportsclub.co.uk`
 * when that is the address in the browser — as opposed to `NEXT_PUBLIC_SITE_URL`,
 * which is the canonical address for links built where there is no request to
 * read (an email, a cron).
 *
 * The difference matters whenever a browser is sent somewhere and expected to
 * still be signed in when it arrives: the session cookie belongs to the host
 * the person is using. The sign-out route learned this on 2026-09-01, /context
 * on 2026-09-08 (#303), and the SumUp payment return on 2026-09-12 — a booker
 * bounced through their bank's 3-D Secure page came back to the canonical
 * host, where no cookie was waiting, and landed on the login page instead of
 * their receipt.
 */
export function originFromHeaders(h: Headers): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim() ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  // Only the club's own hosts. The Host header is attacker-controlled in
  // principle, and a public route that redirects to it would be an open
  // redirect dressed as a club link — so anything else falls back to the
  // canonical address.
  return host && isClubHost(host) ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
}

/** The hosts this app is served on: the club's domain, Vercel's, and a dev box. */
export function isClubHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  return (
    bare === "aomsportsclub.co.uk" ||
    bare.endsWith(".aomsportsclub.co.uk") ||
    bare.endsWith(".vercel.app") ||
    bare === "localhost" ||
    bare === "127.0.0.1"
  );
}

/** For a server action or server component: the origin of the request being served. */
export async function requestOrigin(): Promise<string> {
  return originFromHeaders(await headers());
}
