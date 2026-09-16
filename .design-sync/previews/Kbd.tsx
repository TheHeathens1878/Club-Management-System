import { Kbd } from "@club/web";

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
    <Kbd>⌘K</Kbd>
    <Kbd>Ctrl K</Kbd>
    <Kbd>Esc</Kbd>
    <Kbd>/</Kbd>
  </div>
);

export const InContext = () => (
  <div
    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground"
    style={{ maxWidth: 320 }}
  >
    <span className="min-w-0 flex-1">Search the club</span>
    <Kbd>⌘K</Kbd>
  </div>
);
