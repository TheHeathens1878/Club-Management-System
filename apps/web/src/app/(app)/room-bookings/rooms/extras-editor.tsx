"use client";

/**
 * The extras menu, editable (Adam, 2026-09-04: "We seem to have lost the
 * ability to set what the additional extras cost"). Each extra is either a
 * yes/no at one price (the cold buffet) or a choice of options (table cloth
 * colours), and choice options are written one per line as "Black = 70" —
 * pounds, the way the club talks about them. Prices land in pence in
 * `resources.extras_config`, the same shape `lib/booking-extras` prices the
 * public form against, so what is set here is exactly what is charged.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ExtraConfig } from "@/lib/booking-extras";

import { updateRoomExtras } from "../actions";

type Row = {
  id: string | null;
  name: string;
  type: "choice" | "binary";
  active: boolean;
  pricePounds: string;
  optionsText: string;
};

function rowsFrom(config: ExtraConfig[]): Row[] {
  return config.map((extra) => ({
    id: extra.id,
    name: extra.name,
    type: extra.type,
    active: extra.active,
    pricePounds: extra.type === "binary" ? (extra.price_pence / 100).toString() : "",
    optionsText: extra.options
      .filter((option) => option.price_pence > 0)
      .map((option) => `${option.label} = ${(option.price_pence / 100).toString()}`)
      .join("\n"),
  }));
}

export function ExtrasEditor({ roomId, config }: { roomId: string; config: ExtraConfig[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(rowsFrom(config));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  function set(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSavedTick(false);
  }

  async function save() {
    setError(null);
    setSaving(true);
    const result = await updateRoomExtras(roomId, rows);
    setSaving(false);
    if (result.error) setError(result.error);
    else {
      setSavedTick(true);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.id ?? `new-${index}`} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label htmlFor={`ex-name-${roomId}-${index}`}>Extra</Label>
              <Input
                id={`ex-name-${roomId}-${index}`}
                value={row.name}
                onChange={(e) => set(index, { name: e.target.value })}
                placeholder="e.g. Chair Covers"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ex-type-${roomId}-${index}`}>Kind</Label>
              <select
                id={`ex-type-${roomId}-${index}`}
                value={row.type}
                onChange={(e) => set(index, { type: e.target.value as Row["type"] })}
                className="h-10 rounded-md border bg-background px-2 text-sm"
              >
                <option value="binary">Yes / no</option>
                <option value="choice">Choice of options</option>
              </select>
            </div>
            {row.type === "binary" && (
              <div className="w-28 space-y-1">
                <Label htmlFor={`ex-price-${roomId}-${index}`}>Price (£)</Label>
                <Input
                  id={`ex-price-${roomId}-${index}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.pricePounds}
                  onChange={(e) => set(index, { pricePounds: e.target.value })}
                />
              </div>
            )}
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.active}
                onChange={(e) => set(index, { active: e.target.checked })}
                className="h-4 w-4"
              />
              Offered
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 text-destructive"
              onClick={() => {
                setRows((current) => current.filter((_, i) => i !== index));
                setSavedTick(false);
              }}
              aria-label={`Remove ${row.name || "extra"}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {row.type === "choice" && (
            <div className="space-y-1">
              <Label htmlFor={`ex-opts-${roomId}-${index}`}>
                Options, one per line{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  as &quot;Black = 70&quot; (pounds). &quot;None&quot; is added free automatically.
                </span>
              </Label>
              <textarea
                id={`ex-opts-${roomId}-${index}`}
                value={row.optionsText}
                onChange={(e) => set(index, { optionsText: e.target.value })}
                rows={Math.max(2, row.optionsText.split("\n").length)}
                className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRows((current) => [
              ...current,
              { id: null, name: "", type: "binary", active: true, pricePounds: "", optionsText: "" },
            ]);
            setSavedTick(false);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add an extra
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save extras"}
        </Button>
        {savedTick && <span className="text-sm text-emerald-700">Saved.</span>}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
