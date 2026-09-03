/**
 * Function-room extras (Adam, 2026-09-03: "the extras needs to be reinstated
 * also").
 *
 * The data model never left: `resources.extras_config` is the menu a room
 * offers (seeded from the old room app — table cloths, chair covers, the
 * cold buffet), and `bookings.extras` + `extras_total_pence` are what one
 * booking chose. This module is the one place both sides agree on the shape.
 *
 * Pure and import-safe from client components. THE SERVER RE-PRICES: the
 * browser's selections are labels only, and `priceExtras()` looks every
 * price up in the room's own config — a tampered form can rename nothing
 * and discount nothing.
 */

export type ExtraOption = { label: string; price_pence: number };

export type ExtraConfig = {
  id: string;
  name: string;
  /** "choice" = one option from a list; "binary" = yes/no at one price. */
  type: "choice" | "binary";
  active: boolean;
  options: ExtraOption[];
  price_pence: number;
};

/** What a booking stored: one line per chosen extra, priced at booking time. */
export type ChosenExtra = {
  id: string;
  name: string;
  /** The option label for a choice extra; null for a binary one. */
  choice: string | null;
  price_pence: number;
};

/** `resources.extras_config` is jsonb; read it defensively. */
export function parseExtrasConfig(value: unknown): ExtraConfig[] {
  if (!Array.isArray(value)) return [];
  const out: ExtraConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] !== "string" || typeof record["name"] !== "string") continue;
    if (record["type"] !== "choice" && record["type"] !== "binary") continue;
    const options = Array.isArray(record["options"])
      ? (record["options"] as unknown[]).flatMap((option): ExtraOption[] => {
          if (!option || typeof option !== "object") return [];
          const o = option as Record<string, unknown>;
          if (typeof o["label"] !== "string" || typeof o["price_pence"] !== "number") return [];
          return [{ label: o["label"], price_pence: o["price_pence"] }];
        })
      : [];
    out.push({
      id: record["id"],
      name: record["name"],
      type: record["type"],
      active: record["active"] === true,
      options,
      price_pence: typeof record["price_pence"] === "number" ? record["price_pence"] : 0,
    });
  }
  return out;
}

/**
 * The browser's selections priced against THE ROOM'S OWN menu. A selection
 * naming an extra or an option the room does not offer is dropped, not
 * guessed at; a zero-price option ("None") chooses nothing.
 */
export function priceExtras(
  config: ExtraConfig[],
  selections: Record<string, string | boolean>,
): { chosen: ChosenExtra[]; totalPence: number } {
  const chosen: ChosenExtra[] = [];
  for (const extra of config) {
    if (!extra.active) continue;
    const value = selections[extra.id];
    if (value === undefined) continue;
    if (extra.type === "binary") {
      if (value === true || value === "true") {
        chosen.push({ id: extra.id, name: extra.name, choice: null, price_pence: extra.price_pence });
      }
      continue;
    }
    if (typeof value !== "string") continue;
    const option = extra.options.find((o) => o.label === value);
    if (!option || option.price_pence <= 0) continue;
    chosen.push({ id: extra.id, name: extra.name, choice: option.label, price_pence: option.price_pence });
  }
  return { chosen, totalPence: chosen.reduce((sum, extra) => sum + extra.price_pence, 0) };
}

/** `bookings.extras` back into lines: "Chair Covers (Black) — £200.00". */
export function chosenExtrasFrom(value: unknown): ChosenExtra[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry): ChosenExtra[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record["name"] !== "string" || typeof record["price_pence"] !== "number") return [];
    return [
      {
        id: typeof record["id"] === "string" ? record["id"] : "",
        name: record["name"],
        choice: typeof record["choice"] === "string" ? record["choice"] : null,
        price_pence: record["price_pence"],
      },
    ];
  });
}

export function extraLabel(extra: ChosenExtra): string {
  return extra.choice ? `${extra.name} (${extra.choice})` : extra.name;
}

export function poundsLabel(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function extrasSummary(value: unknown): string {
  const chosen = chosenExtrasFrom(value);
  if (chosen.length === 0) return "";
  return chosen.map((e) => `${extraLabel(e)} — ${poundsLabel(e.price_pence)}`).join("; ");
}
