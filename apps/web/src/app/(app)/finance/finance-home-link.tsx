"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark } from "lucide-react";

/**
 * "When in any finance screen, there should be a button to go back to finance
 * home" (Adam, 2026-09-04). Rendered by the /finance segment layout on every
 * page in the section; hides itself on the home page it points at.
 */
export function FinanceHomeLink() {
  const pathname = usePathname();
  if (pathname === "/finance") return null;
  return (
    <div className="px-4 pt-4 lg:px-6">
      <Link
        href="/finance"
        className="inline-flex min-h-[40px] items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-secondary"
      >
        <Landmark className="h-4 w-4" aria-hidden />
        Finance home
      </Link>
    </div>
  );
}
