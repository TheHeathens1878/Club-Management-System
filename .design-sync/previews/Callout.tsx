import { Callout } from "@club/web";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export const Variants = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
    <Callout icon={<Info className="h-4 w-4" aria-hidden />}>
      Fixtures, training and socials share one diary, so a clash cannot hide in another list.
    </Callout>
    <Callout tone="success" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}>
      Confirmation emailed to Leanne Minto.
    </Callout>
    <Callout tone="warning" title="Two players have no date of birth" icon={<TriangleAlert className="h-4 w-4" aria-hidden />}>
      The FA age band cannot be worked out until they do.
    </Callout>
    <Callout tone="danger" title="Payment declined" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
      The card was refused. Nothing has been taken.
    </Callout>
  </div>
);

export const InContext = () => (
  <div className="space-y-3 rounded-xl border bg-card p-4" style={{ maxWidth: 480 }}>
    <p className="text-row font-semibold leading-tight">Saturday 14:00 · Pitch 1</p>
    <Callout tone="warning" title="Pitch 1 is double-booked" icon={<TriangleAlert className="h-4 w-4" aria-hidden />}>
      U12 Jupiter are already on it. Move one of the two before Friday.
    </Callout>
  </div>
);
