import type { ReactNode } from "react";
import { Landmark } from "lucide-react";

import { SectionHomeLink } from "@/components/section-home-link";

// The one thing every finance screen shares: the way back to Finance home.
// Authorisation stays per-page (requireFinance) — a layout is not a guard.
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionHomeLink href="/finance" label="Finance home" icon={Landmark} />
      {children}
    </>
  );
}
