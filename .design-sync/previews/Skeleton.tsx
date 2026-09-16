import { Skeleton } from "@club/web";

export const Variants = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
    <Skeleton className="h-4 w-1/3" />
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-9 w-9 rounded-lg" />
  </div>
);

// The loading state is drawn in the shape of the screen that is arriving, and
// announced once by the region around it rather than by every bar inside it.
export const InContext = () => (
  <div style={{ maxWidth: 420 }} aria-busy="true" aria-label="Loading the team list">
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </li>
      ))}
    </ul>
  </div>
);
