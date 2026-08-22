"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { saveNotificationRecipients } from "./actions";

export type StaffUser = { id: string; email: string; full_name: string | null; role: string };

const GROUPS: { key: string; title: string; desc: string }[] = [
  { key: "notify_booking_request", title: "New booking requests", desc: "When a booker submits a request on the public page." },
  { key: "notify_cancellation", title: "Cancellations", desc: "When a booking is cancelled by staff." },
  { key: "notify_auto_cancellation", title: "Auto-cancellations", desc: "When a booking is automatically cancelled for an unpaid deposit." },
];

export function NotificationsForm({
  staff,
  selections,
}: {
  staff: StaffUser[];
  selections: Record<string, string[]>;
}) {
  const [ok, setOk] = useState(false);

  async function onSubmit(formData: FormData) {
    setOk(false);
    await saveNotificationRecipients(formData);
    setOk(true);
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {staff.length === 0 && (
        <p className="text-sm text-muted-foreground">No staff accounts found.</p>
      )}

      {GROUPS.map((g) => {
        const selected = new Set(selections[g.key] ?? []);
        return (
          <div key={g.key} className="rounded-lg border p-4">
            <p className="text-sm font-semibold">{g.title}</p>
            <p className="text-xs text-muted-foreground mb-3">{g.desc}</p>
            <div className="space-y-2">
              {staff.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={g.key}
                    value={u.id}
                    defaultChecked={selected.has(u.id)}
                  />
                  <span>
                    {u.full_name ?? u.email}
                    {u.full_name && <span className="text-muted-foreground"> · {u.email}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        If no one is selected for an event, all super users and committee members are notified by default.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit">Save notification recipients</Button>
        {ok && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </form>
  );
}
