const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A few squads at a time, not the whole club in one file. */
export const MAX_EXPORT_TEAMS = 20;

/** The `?team=` ids on a request, deduplicated, validated, capped. */
export function teamIdsFrom(request: Request): string[] {
  const url = new URL(request.url);
  const ids = url.searchParams
    .getAll("team")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID_RE.test(value));
  return Array.from(new Set(ids)).slice(0, MAX_EXPORT_TEAMS);
}
