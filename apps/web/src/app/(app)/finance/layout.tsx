import type { ReactNode } from "react";

import { FinanceHomeLink } from "./finance-home-link";

// The one thing every finance screen shares: the way back to Finance home.
// Authorisation stays per-page (requireFinance) — a layout is not a guard.
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <FinanceHomeLink />
      {children}
    </>
  );
}
