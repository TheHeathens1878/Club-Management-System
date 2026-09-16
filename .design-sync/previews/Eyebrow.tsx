import { Eyebrow } from "@club/web";

export const Variants = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <Eyebrow>Your teams</Eyebrow>
    <Eyebrow tone="primary">Show me</Eyebrow>
    <Eyebrow tone="accent">Waiting on you</Eyebrow>
  </div>
);

export const InContext = () => (
  <div style={{ maxWidth: 420 }} className="space-y-1.5">
    <Eyebrow as="h2" id="eyebrow-tuesdays" className="px-1">
      Tuesdays
    </Eyebrow>
    <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
      <li className="px-4 py-2.5">18:00 · U11 Venus · Pitch 2</li>
      <li className="px-4 py-2.5">19:00 · U12 Jupiter · Pitch 2</li>
      <li className="px-4 py-2.5">20:00 · Adults · Pitch 1</li>
    </ul>
  </div>
);
