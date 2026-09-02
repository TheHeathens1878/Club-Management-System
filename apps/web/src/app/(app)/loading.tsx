/**
 * The instant answer to a tap.
 *
 * Every screen in the signed-in shell is `force-dynamic` — a live read of the
 * member's own data under RLS — so navigation always waits on the server. On
 * a phone that used to look like nothing happening: the old screen sat there,
 * frozen, until the new one arrived whole. This boundary is what App Router
 * shows the moment the route changes, so a tap now lands somewhere visibly
 * loading instead of appearing ignored.
 *
 * One skeleton for the whole (app) group on purpose: it sketches the shape
 * almost every page opens with — a header strip, then cards — and a single
 * shared boundary means every route has one, including the ones nobody
 * remembered to give one to.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {/* The PageHeader strip: title line over subtitle line. */}
      <div className="border-b border-border bg-card px-4 py-4 lg:px-6">
        <div className="h-6 w-44 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3.5 w-72 max-w-full animate-pulse rounded bg-muted" />
      </div>

      <div className="space-y-4 p-4 lg:p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
