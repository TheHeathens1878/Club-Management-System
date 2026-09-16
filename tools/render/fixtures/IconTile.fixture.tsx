/**
 * The tinted square that starts a row. Every size, every tone and both
 * shapes in one shot, because the thing that goes wrong with an icon tile is
 * never one tile — it is two of them side by side that turn out to be
 * different sizes.
 */

import { CalendarCheck2, CalendarOff, LandPlot, Receipt, Users } from "lucide-react";

import { IconTile } from "@/components/ui/icon-tile";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-4 p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    tones: () => (
      <Frame>
        <div className="flex flex-wrap items-center gap-3">
          <IconTile tone="primary" icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />} />
          <IconTile tone="muted" icon={<Users className="h-4 w-4" aria-hidden />} />
          <IconTile tone="success" icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />} />
          <IconTile tone="warning" icon={<CalendarOff className="h-4 w-4" aria-hidden />} />
          <IconTile tone="info" icon={<LandPlot className="h-4 w-4" aria-hidden />} />
        </div>
      </Frame>
    ),

    sizes: () => (
      <Frame>
        <div className="flex flex-wrap items-center gap-3">
          <IconTile size="sm" icon={<Receipt className="h-4 w-4" aria-hidden />} />
          <IconTile size="md" icon={<Receipt className="h-4 w-4" aria-hidden />} />
          <IconTile size="lg" icon={<Receipt className="h-5 w-5" aria-hidden />} />
          <IconTile size="lg" shape="round" tone="muted" icon={<Users className="h-5 w-5" aria-hidden />} />
        </div>
      </Frame>
    ),
  },
};

export default fixture;
