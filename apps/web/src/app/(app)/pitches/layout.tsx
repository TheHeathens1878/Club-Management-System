import type { ReactNode } from "react";
import { LandPlot } from "lucide-react";

import { SectionHomeLink } from "@/components/section-home-link";

// Every pitch screen shares the way back to the pitches home. Authorisation
// stays per-page — a layout is not a guard.
export default function PitchesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionHomeLink href="/pitches" label="Pitches home" icon={LandPlot} />
      {children}
    </>
  );
}
