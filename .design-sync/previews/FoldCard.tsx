import { Button, FoldCard, Input, Label } from "@club/web";
import { CalendarOff, MapPin, User } from "lucide-react";

// The settings fold beneath the work, and the closed row says what it holds —
// so the summary is real text the server computed, not "Details".
export const Folded = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
    <FoldCard
      icon={<CalendarOff className="h-4 w-4" aria-hidden />}
      title="Dates off"
      summary="Christmas, Half-term · 3 weeks skipped"
    >
      <p className="text-sm text-muted-foreground">Nothing is booked on these dates and nobody is charged for them.</p>
    </FoldCard>
    <FoldCard
      icon={<MapPin className="h-4 w-4" aria-hidden />}
      title="Venues"
      summary="Carrington 3G · Sale Leisure, Hall 2"
    >
      <p className="text-sm text-muted-foreground">Two grounds share this block; each slot names its own.</p>
    </FoldCard>
    <FoldCard icon={<User className="h-4 w-4" aria-hidden />} title="Booker" summary="Jane Smith · jane@example.org · 07700 900123">
      <p className="text-sm text-muted-foreground">Everything the club sends about this block goes to Jane.</p>
    </FoldCard>
  </div>
);

export const Open = () => (
  <div style={{ maxWidth: 520 }}>
    <FoldCard
      icon={<CalendarOff className="h-4 w-4" aria-hidden />}
      title="Block details"
      summary="6 January to 24 March · Tuesdays and Thursdays"
      defaultOpen
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fold-name">Name</Label>
          <Input id="fold-name" defaultValue="Winter training block" className="touch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fold-from">Starts</Label>
          <Input id="fold-from" type="date" defaultValue="2027-01-06" className="touch" />
        </div>
        <Button size="touch">Save the block</Button>
      </div>
    </FoldCard>
  </div>
);
