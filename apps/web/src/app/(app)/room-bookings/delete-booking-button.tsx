"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteBooking } from "./actions";

export function DeleteBookingButton({ id, label }: { id: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (!confirm("Permanently delete this booking? This cannot be undone.")) return;
    setBusy(true);
    const result = await deleteBooking(id);
    if (result?.error) {
      alert(result.error);
      setBusy(false);
    } else if (label) {
      // navigated from detail page — go back to list
      router.push("/room-bookings");
    }
  }

  if (label) {
    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={handleClick}
        disabled={busy}
        className="min-h-[44px] w-full gap-2 lg:min-h-0 lg:w-auto"
      >
        <Trash2 className="h-4 w-4" />
        {busy ? "Deleting…" : label}
      </Button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title="Delete booking"
      className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
