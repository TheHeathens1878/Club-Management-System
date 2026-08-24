/**
 * Fixture vocabulary shared by client components (the fixtures table) and
 * server pages (the fixture attendance page). Plain module on purpose — a
 * function exported from a "use client" file is a client reference a server
 * component cannot call (the /events/[id] lesson, 2026-08-24).
 */

export function fixtureStatusVariant(
  status: string,
): "success" | "muted" | "destructive" | "warning" | "default" {
  if (status === "played") return "success";
  if (status === "cancelled" || status === "abandoned") return "destructive";
  if (status === "postponed") return "warning";
  return "default";
}
