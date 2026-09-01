export function PageHeader({
  title,
  subtitle,
  action,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /**
   * For a page whose real content has to fill the phone screen — a
   * conversation, above all. The full header spends about a third of a phone
   * on a 2xl title, a subtitle that only ever restates the route, and an
   * action row wrapping onto a second 44px line; compact keeps all of it on
   * one line and hands the rest back to the page (Adam, 2026-09-01: "reduce
   * the space needed for other things on the page"). Above lg, where there is
   * room, it is the same header as everywhere else.
   */
  compact?: boolean;
}) {
  return (
    <div
      className={
        "flex justify-between gap-3 border-b bg-card px-4 lg:flex-wrap lg:items-end lg:px-8 lg:py-6 " +
        (compact ? "items-center py-2" : "flex-wrap items-end py-4")
      }
    >
      <div className="min-w-0">
        {/* Crest display type: Oswald condensed caps, as the design's page titles. */}
        <h1
          className={
            "font-display font-semibold uppercase tracking-wide lg:text-2xl " +
            (compact ? "truncate text-lg" : "text-2xl")
          }
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={
              "mt-1 text-sm text-muted-foreground " + (compact ? "hidden lg:block" : "")
            }
          >
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
