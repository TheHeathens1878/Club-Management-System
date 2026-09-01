/**
 * A player's face in a circle — initials today, a photo the day there is one
 * (Adam, 2026-08-25: "the avatar or the player's initials should appear on the
 * line-up section"). There is no photo store yet, so `photoUrl` is always
 * undefined at the call sites; when one arrives, filling it in is the whole
 * change. Deliberately dumb: no data access, so a client component can use it.
 */

import { cn } from "@/lib/utils";

/** Up to two initials, never empty — the same rule the people book uses. */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** First name only — what fits under a token on a 390px pitch. */
export function firstNameOf(name: string): string {
  return name.split(/\s+/).filter(Boolean)[0] ?? name;
}

export function PlayerToken({
  name,
  photoUrl,
  className,
  shirtNumber,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
  /** Drawn as a small badge on the token when the squad list has one. */
  shirtNumber?: number | null;
}) {
  return (
    <span
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full border-2 border-white/90 bg-primary font-display text-[11px] font-semibold uppercase leading-none tracking-wide text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      {photoUrl ? (
        // An avatar is an arbitrary remote URL, so next/image would need a host
        // allowlist it cannot have; a plain img is the honest thing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name)
      )}
      {shirtNumber !== null && shirtNumber !== undefined && (
        <span className="absolute -bottom-0.5 right-0 rounded-full bg-background px-1 text-[8px] font-semibold text-foreground">
          {shirtNumber}
        </span>
      )}
    </span>
  );
}
