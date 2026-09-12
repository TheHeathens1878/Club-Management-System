import Link from "next/link";

/**
 * The filter rail (P7.5, the three-noun design): on a desktop a list's
 * filters stand in a column to its left — "Show me" (what kind), "Whose"
 * (which team) — each option a row with a colour swatch, its label and the
 * live count, the chosen one filled. The counts are the list's own, so the
 * rail never promises rows the page will not show.
 *
 * Below lg the rail is not drawn: the page keeps its chip strips, which are
 * the same filters at thumb size. Both are LINKS — every filter is a URL, so
 * a filtered view can be shared and the back button undoes a tap.
 */

export type RailOption = {
  href: string;
  label: string;
  active: boolean;
  /** A CSS colour for the swatch; omit for a plain row. */
  swatch?: string;
  count?: number | string;
};

export type RailGroup = { title: string; options: RailOption[] };

export function FilterRail({
  groups,
  note,
  footnote,
  children,
}: {
  groups: RailGroup[];
  /** A one-line thing worth knowing about this list — "1 clash this week". */
  note?: { title: string; body: string };
  footnote?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lg:flex lg:min-h-full lg:items-stretch">
      <aside className="hidden w-[222px] flex-none flex-col border-r border-border bg-card px-[13px] py-[18px] lg:flex">
        {groups.map((group, index) => (
          <div key={group.title} className={index === 0 ? "" : "mt-[22px]"}>
            <p className="font-display mb-2.5 ml-1.5 text-[9px] font-medium uppercase leading-none tracking-[0.16em] text-muted-foreground">
              {group.title}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.options.map((option) => (
                <Link
                  key={option.href}
                  href={option.href}
                  aria-current={option.active ? "page" : undefined}
                  className={
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-[13px] leading-none transition-colors " +
                    (option.active
                      ? "bg-secondary font-semibold text-foreground"
                      : "text-foreground hover:bg-secondary/60")
                  }
                >
                  {option.swatch ? (
                    <span
                      aria-hidden
                      className="h-[9px] w-[9px] flex-none rounded-[2px]"
                      style={{ background: option.swatch }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.count !== undefined ? (
                    <span
                      className={
                        "text-[11px] " + (option.active ? "text-foreground" : "text-muted-foreground")
                      }
                    >
                      {option.count}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        ))}
        {note ? (
          <div className="mt-[22px] rounded-[9px] border border-amber-700/30 bg-amber-600/10 p-3">
            <p className="mb-1 text-[11.5px] font-semibold leading-snug text-amber-900">{note.title}</p>
            <p className="text-[11.5px] leading-snug text-amber-900">{note.body}</p>
          </div>
        ) : null}
        {footnote ? (
          <p className="ml-1.5 mt-auto pt-6 text-[11.5px] leading-relaxed text-muted-foreground">{footnote}</p>
        ) : null}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
