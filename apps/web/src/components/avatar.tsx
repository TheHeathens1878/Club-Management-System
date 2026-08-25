/**
 * One person, one circle: the registration photo where there is one, initials
 * where there is not.
 *
 * Four screens grew their own `initialsOf()` before this existed. The photo
 * Adam asked for at registration "automatically becomes the avatar for the
 * contact", which only means anything if every list draws it the same way, so
 * this is the one that does.
 *
 * `photoUrl` is a SHORT-LIVED SIGNED URL minted on the server by
 * `lib/avatars.ts`. This component never fetches anything and never knows a
 * storage path: if the caller was not entitled to a URL it simply renders
 * initials, which is the correct outcome and not a broken image.
 *
 * A plain <img>, not next/image: the URL expires within the quarter-hour, so
 * there is nothing worth putting through the optimiser and a cached
 * transformation would outlive its own signature.
 */

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-9 w-9 text-[11px]",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-lg",
} as const;

export type AvatarSize = keyof typeof SIZES;

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("en-GB") ?? "")
      .join("") || "?"
  );
}

export function Avatar({
  name,
  photoUrl,
  size = "md",
  className = "",
}: {
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const shape =
    "relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-secondary font-semibold text-foreground/70 " +
    SIZES[size];

  if (photoUrl) {
    return (
      <span className={`${shape} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={`${shape} ${className}`}>
      {initialsOf(name)}
    </span>
  );
}
