export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b bg-card px-8 py-6">
      <div>
        {/* Crest display type: Oswald condensed caps, as the design's page titles. */}
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
