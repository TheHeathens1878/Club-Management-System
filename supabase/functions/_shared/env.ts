// Environment access for Edge Functions.
//
// Two rules the functions here follow:
//   * platform variables (SUPABASE_URL, the keys) are always present in the
//     edge runtime, so they are read eagerly and asserted once;
//   * feature secrets (Stripe, Resend, Twilio) are read lazily through
//     `optionalEnv`, because a function must be able to report "this provider
//     is not configured" as data rather than crashing the whole invocation.

export function optionalEnv(name: string): string | null {
  const v = Deno.env.get(name);
  return v === undefined || v.trim() === "" ? null : v;
}

export class MissingSecretError extends Error {
  constructor(public readonly name: string) {
    super(`missing secret ${name} — set it with \`supabase secrets set ${name}=...\``);
    this.name = "MissingSecretError";
  }
}

export function requireEnv(name: string): string {
  const v = optionalEnv(name);
  if (v === null) throw new MissingSecretError(name);
  return v;
}

/** All present, or the list of the ones that are not. */
export function checkSecrets(names: string[]): { ok: true } | { ok: false; missing: string[] } {
  const missing = names.filter((n) => optionalEnv(n) === null);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
export const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

/** Where the web app lives — used for Stripe return URLs. */
export function siteUrl(): string {
  return (optionalEnv("PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}
