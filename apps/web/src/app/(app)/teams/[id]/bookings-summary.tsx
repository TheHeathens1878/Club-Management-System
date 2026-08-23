import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  formatSlot,
  kindLabel,
  statusLabel,
  statusVariant,
  type PitchBookingItem,
} from "@/lib/pitch-booking";

/**
 * The team's next few pitch slots, read-only — the Bookings tab is where they
 * are cancelled or added to. Same rows, same RLS: whatever
 * `loadTeamPitchBookings()` was allowed to return.
 */
export function PitchBookingsSummary({
  teamId,
  items,
}: {
  teamId: string;
  items: PitchBookingItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <p className="py-6 text-center text-sm text-muted-foreground">
          No pitch bookings for this team yet.
        </p>
        <Link
          href={`/teams/${teamId}?tab=bookings`}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Book a pitch
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {item.label ?? item.teamName ?? "Pitch booking"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatSlot(item)} · {item.resourceName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
              <Badge variant="muted">{kindLabel(item.kind)}</Badge>
            </div>
          </li>
        ))}
      </ul>
      <Link
        href={`/teams/${teamId}?tab=bookings`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        All pitch bookings
      </Link>
    </div>
  );
}
