"use client";

import { useState, useTransition } from "react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateBooking } from "./actions";

type Room = { id: string; name: string };

type Props = {
  bookingId: string;
  rooms: Room[];
  initial: {
    room_id: string;
    date: string;
    start_time: string;
    end_time: string;
    booker_first_name: string;
    booker_last_name: string;
    booker_email: string;
    booker_phone: string;
    occasion: string;
    estimated_guests: string;
    notes: string;
  };
};

export function EditBookingForm({ bookingId, rooms, initial }: Props) {
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function set(k: keyof typeof fields, v: string) {
    setFields((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const first = fields.booker_first_name.trim();
      const last = fields.booker_last_name.trim();
      const result = await updateBooking(bookingId, {
        room_id: fields.room_id,
        date: fields.date,
        start_time: fields.start_time,
        end_time: fields.end_time,
        booker_first_name: first,
        booker_last_name: last,
        booker_name: `${first} ${last}`.trim(),
        booker_email: fields.booker_email.trim(),
        booker_phone: fields.booker_phone.trim() || null,
        occasion: fields.occasion.trim() || null,
        estimated_guests: fields.estimated_guests ? Number(fields.estimated_guests) : null,
        notes: fields.notes.trim() || null,
      });
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Room</Label>
        <select
          value={fields.room_id}
          onChange={(e) => set("room_id", e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={fields.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Start time</Label>
          <Input type="time" value={fields.start_time} onChange={(e) => set("start_time", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>End time</Label>
          <Input type="time" value={fields.end_time} onChange={(e) => set("end_time", e.target.value)} required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>First name</Label>
          <Input value={fields.booker_first_name} onChange={(e) => set("booker_first_name", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Last name</Label>
          <Input value={fields.booker_last_name} onChange={(e) => set("booker_last_name", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Booker email</Label>
          <Input type="email" value={fields.booker_email} onChange={(e) => set("booker_email", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Mobile number</Label>
          <Input type="tel" value={fields.booker_phone} onChange={(e) => set("booker_phone", e.target.value)} placeholder="e.g. 07700 900000" />
        </div>
        <div className="space-y-1.5">
          <Label>Occasion</Label>
          <Input value={fields.occasion} onChange={(e) => set("occasion", e.target.value)} placeholder="e.g. Birthday" />
        </div>
        <div className="space-y-1.5">
          <Label>Estimated guests</Label>
          <Input type="number" min="1" value={fields.estimated_guests} onChange={(e) => set("estimated_guests", e.target.value)} placeholder="Approx. number" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notes from booker</Label>
        <textarea
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved successfully.</p>}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
