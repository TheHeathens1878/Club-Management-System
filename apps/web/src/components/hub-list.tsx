import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * The hub pattern (P7.2): a destination's contents as grouped rows — the
 * iOS Settings shape. Every row is one 44px+ target with an icon, a label,
 * an optional line of detail, a count when something is waiting, and a
 * chevron, so the eye reads "these are places" before it reads a word.
 *
 * Rows are plain links. Whatever hat a row opens in is already baked into
 * its href by `linkHref` — this component knows nothing about roles.
 */
export type HubRow = {
  href: string;
  label: string;
  icon: LucideIcon;
  detail?: string;
  badge?: number;
};

export type HubSection = { section: string; rows: HubRow[] };

export function HubList({ sections }: { sections: HubSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.section} aria-labelledby={`hub-${slug(section.section)}`}>
          <h2
            id={`hub-${slug(section.section)}`}
            className="font-display mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
          >
            {section.section}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {section.rows.map((row) => {
              const Icon = row.icon;
              return (
                <li key={`${row.href}|${row.label}`}>
                  <Link
                    href={row.href}
                    className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
                  >
                    <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium leading-snug">{row.label}</span>
                      {row.detail ? (
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                          {row.detail}
                        </span>
                      ) : null}
                    </span>
                    {row.badge ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold leading-none text-accent-foreground">
                        {row.badge > 99 ? "99+" : row.badge}
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
