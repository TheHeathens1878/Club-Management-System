"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBlockBooking } from "./actions";

export function BlockBookingForm({ rooms }: { rooms: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState("weekly");
  const [blockDate, setBlockDate] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createBlockBooking(fd);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setOpen(false);
      setRecurring(false);
      setFreq("weekly");
      setBlockDate("");
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Block time slot
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Block a time slot</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="block_room_id">Room *</Label>
              <select
                id="block_room_id"
                name="room_id"
                required
                className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0"
              >
                <option value="">Select a room…</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block_date">Date *</Label>
              <Input type="date" id="block_date" name="date" required value={blockDate} onChange={(e) => setBlockDate(e.target.value)} />
            </div>
            <div />
            <div className="space-y-1.5">
              <Label htmlFor="block_start">Start time *</Label>
              <Input type="time" id="block_start" name="start_time" required defaultValue="09:00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block_end">End time *</Label>
              <Input type="time" id="block_end" name="end_time" required defaultValue="17:00" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="block_reason">
                Reason <span className="text-muted-foreground text-xs">(internal only)</span>
              </Label>
              <Input
                id="block_reason"
                name="reason"
                placeholder="e.g. Staff training, Deep clean, Club event"
              />
            </div>
          </div>

          {/* Recurrence */}
          <div className="border-t pt-3 space-y-3">
            <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium cursor-pointer lg:min-h-0">
              <input
                type="checkbox"
                name="recurring"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Repeat on a schedule
            </label>
            {recurring && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="block_freq">Frequency</Label>
                    <select
                      id="block_freq"
                      name="recurrence_freq"
                      value={freq}
                      onChange={(e) => setFreq(e.target.value)}
                      className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="fortnightly">Fortnightly</option>
                      <option value="monthly">Monthly (same date)</option>
                      <option value="monthly_weekday">Monthly (same weekday)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="block_until">Repeat until</Label>
                    <Input type="date" id="block_until" name="recurrence_until" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="block_count">Or max occurrences</Label>
                    <Input type="number" id="block_count" name="recurrence_count" min="1" max="104" placeholder="e.g. 12" />
                  </div>
                </div>
                {freq === "monthly_weekday" && blockDate && (() => {
                  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
                  const ORDINALS = ["","1st","2nd","3rd","4th","5th"];
                  const d = new Date(blockDate + "T12:00:00Z");
                  const nth = Math.ceil(d.getUTCDate() / 7);
                  return (
                    <p className="text-xs text-muted-foreground">
                      Will repeat on the {ORDINALS[nth]} {DAYS[d.getUTCDay()]} of each month.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button type="submit" disabled={saving} className="min-h-[44px] flex-1 lg:min-h-0 lg:flex-none">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : recurring ? "Create repeating blocks" : "Create block"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); setError(null); setRecurring(false); }}
              className="min-h-[44px] lg:min-h-0"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
