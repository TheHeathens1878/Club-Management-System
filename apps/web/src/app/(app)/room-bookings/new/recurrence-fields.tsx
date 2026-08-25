"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th"];

export function DateTimingFields() {
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState("weekly");
  const [date, setDate] = useState("");

  function weekdayHint() {
    if (freq !== "monthly_weekday" || !date) return null;
    const d = new Date(date + "T12:00:00Z");
    const nth = Math.ceil(d.getUTCDate() / 7);
    return `Will repeat on the ${ORDINALS[nth]} ${DAYS[d.getUTCDay()]} of each month.`;
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="date">Date *</Label>
          <Input
            type="date"
            id="date"
            name="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="start_time">Start time *</Label>
          <Input type="time" id="start_time" name="start_time" required defaultValue="19:00" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end_time">End time *</Label>
          <Input type="time" id="end_time" name="end_time" required defaultValue="23:00" />
        </div>
      </div>

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
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="recurrence_freq">Frequency</Label>
                <select
                  id="recurrence_freq"
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
                <Label htmlFor="recurrence_until">Repeat until</Label>
                <Input type="date" id="recurrence_until" name="recurrence_until" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurrence_count">Or max occurrences</Label>
                <Input type="number" id="recurrence_count" name="recurrence_count" min="1" max="104" placeholder="e.g. 12" />
              </div>
            </div>
            {weekdayHint() && (
              <p className="text-xs text-muted-foreground">{weekdayHint()}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
