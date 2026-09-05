import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/**
 * A list with nothing in it, said plainly (P7.2 screen patterns): what this
 * screen would show, why it is empty, and — when there is one — the single
 * thing to do about it. The same card on every empty list, so an empty
 * screen is never mistaken for a broken one.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-8 text-center">
      {Icon ? (
        <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <p className="text-[15px] font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{children}</p> : null}
      {action ? (
        <Link href={action.href} className={buttonVariants({ size: "sm" }) + " mt-4 min-h-[44px] lg:min-h-0"}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
