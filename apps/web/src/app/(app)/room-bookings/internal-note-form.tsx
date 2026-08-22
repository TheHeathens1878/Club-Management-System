"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { addInternalNote } from "./actions";

export function InternalNoteForm({
  bookingId,
  initialNote,
}: {
  bookingId: string;
  initialNote: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    const result = await addInternalNote(bookingId, note);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={note}
        onChange={(e) => { setNote(e.target.value); setSaved(false); }}
        rows={4}
        placeholder="Add notes visible only to staff…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-emerald-600">Notes saved.</p>}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Save notes
      </button>
    </form>
  );
}
