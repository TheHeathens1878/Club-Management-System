import { IconTile } from "@club/web";
import { CalendarOff, Landmark, MapPin, ShieldAlert, Users } from "lucide-react";

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
    <IconTile icon={<Users className="h-4 w-4" aria-hidden />} />
    <IconTile icon={<MapPin className="h-4 w-4" aria-hidden />} tone="info" />
    <IconTile icon={<Landmark className="h-4 w-4" aria-hidden />} tone="success" />
    <IconTile icon={<ShieldAlert className="h-4 w-4" aria-hidden />} tone="warning" />
    <IconTile icon={<CalendarOff className="h-4 w-4" aria-hidden />} tone="muted" />
    <IconTile icon={<Users className="h-5 w-5" aria-hidden />} size="md" />
    <IconTile icon={<Users className="h-5 w-5" aria-hidden />} size="lg" shape="round" tone="muted" />
  </div>
);

export const InContext = () => (
  <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3" style={{ maxWidth: 420 }}>
    <IconTile icon={<CalendarOff className="h-4 w-4" aria-hidden />} />
    <span className="min-w-0 flex-1">
      <span className="block text-row font-medium leading-snug">Dates off</span>
      <span className="block text-xs text-muted-foreground">Christmas, Half-term</span>
    </span>
  </div>
);
