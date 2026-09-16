import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * A list with nothing in it, said plainly (P7.2 screen patterns): what this
 * screen would show, why it is empty, and — when there is one — the single
 * thing to do about it. The same card on every empty list, so an empty
 * screen is never mistaken for a broken one.
 *
 * The icon arrives RENDERED — `icon={<Users className="h-5 w-5" aria-hidden />}`
 * — not as a component. A server page cannot hand a function to a client
 * component, and while this one is a server component today, every empty
 * list in the app points at it; the day one of them sits inside a sheet the
 * old shape would have been a 500 (P8.0d).
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-8 text-center">
      {icon ? <IconTile icon={icon} size="lg" tone="muted" shape="round" className="mx-auto mb-3" /> : null}
      <p className="text-row font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{children}</p> : null}
      {action ? (
        <Link href={action.href} className={buttonVariants({ size: "sm" }) + " mt-4 touch"}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
