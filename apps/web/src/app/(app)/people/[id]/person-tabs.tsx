import Link from "next/link";

/**
 * The contact record's tab bar (Adam, 2026-08-26: "If you click into the
 * contact, there should be another tab saying Membership and payments").
 *
 * A server component and real links, like the match page's `EventTabs` and the
 * team page's `TeamTabs`: every tab is somewhere you can send somebody, come
 * back to, and reload.
 */

export const PERSON_TABS = ["record", "membership"] as const;

export type PersonTabKey = (typeof PERSON_TABS)[number];

const LABELS: Record<PersonTabKey, string> = {
  record: "Record",
  membership: "Membership and payments",
};

/** `?tab=` from the URL, or the record for anything unrecognised. */
export function personTabFrom(value: string | string[] | undefined): PersonTabKey {
  const key = Array.isArray(value) ? value[0] : value;
  return (PERSON_TABS as readonly string[]).includes(key ?? "")
    ? (key as PersonTabKey)
    : "record";
}

export function PersonTabs({
  personId,
  active,
  from,
}: {
  personId: string;
  active: PersonTabKey;
  /** The list this record was opened from, so Back still lands there. */
  from?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav
        aria-label="Contact sections"
        className="inline-flex min-w-max gap-1 rounded-lg bg-secondary p-1"
      >
        {PERSON_TABS.map((tab) => {
          const params = new URLSearchParams();
          if (tab !== "record") params.set("tab", tab);
          if (from) params.set("from", from);
          const query = params.toString();
          return (
            <Link
              key={tab}
              href={`/people/${personId}${query ? `?${query}` : ""}`}
              aria-current={tab === active ? "page" : undefined}
              className={
                "flex min-h-[44px] items-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors sm:min-h-[34px] " +
                (tab === active
                  ? "bg-card shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {LABELS[tab]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
