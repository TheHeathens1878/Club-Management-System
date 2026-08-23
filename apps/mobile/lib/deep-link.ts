/**
 * Magic links open the app rather than a browser, so nothing parses the URL for
 * us the way `detectSessionInUrl` does on the web. These helpers turn an
 * incoming deep link into the one thing the auth provider needs to do next.
 *
 * PKCE (what the shared RN client configures) puts a one-time `code` in the
 * query string. The implicit flow — and some older Supabase email templates —
 * put `access_token`/`refresh_token` in the fragment instead, so both are
 * handled. Errors come back as `error_description`.
 *
 * Pure: no React Native imports, unit-tested in lib/deep-link.test.ts.
 */

export type AuthRedirect =
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string };

function paramsOf(url: URL): URLSearchParams {
  const search = new URLSearchParams(url.search);
  // The fragment is `#a=b&c=d`; strip the leading "#" before parsing.
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [key, value] of fragment.entries()) {
    if (!search.has(key)) search.set(key, value);
  }
  return search;
}

/**
 * Returns what the link is asking the app to do, or `null` when the link has
 * nothing auth-related in it (an ordinary deep link into a screen).
 */
export function parseAuthRedirect(rawUrl: string | null): AuthRedirect | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const params = paramsOf(url);

  const errorDescription =
    params.get("error_description") ?? params.get("error");
  if (errorDescription) {
    return { kind: "error", message: errorDescription.replace(/\+/g, " ") };
  }

  const code = params.get("code");
  if (code) return { kind: "code", code };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "tokens", accessToken, refreshToken };
  }

  return null;
}
