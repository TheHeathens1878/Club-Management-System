"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addStaffAway, removeStaffAway } from "./staff-away-actions";

export type StaffMember = { id: string; name: string; role: string; type: "profile" | "external" };
export type AwayEntry = { id: string; staffId: string; staffName: string; fromDate: string; toDate: string; note?: string | null };

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function StaffAwayPanel({
  staffList,
  awayEntries,
  currentUserId,
  isCommittee,
}: {
  staffList: StaffMember[];
  awayEntries: AwayEntry[];
  currentUserId: string;
  isCommittee: boolean;
}) {
  const router = useRouter();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default selected staff: self if bar, first in list if committee
  const defaultStaff = isCommittee ? (staffList[0]?.id ?? "") : currentUserId;
  const [selectedStaff, setSelectedStaff] = useState(defaultStaff);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [note, setNote] = useState("");

  // Upcoming + current away entries (not ended before today)
  const relevantEntries = awayEntries.filter((e) => e.toDate >= today);
  const pastEntries = awayEntries.filter((e) => e.toDate < today);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set("staff_id", selectedStaff);
    fd.set("staff_type", staffList.find((s) => s.id === selectedStaff)?.type ?? "profile");
    fd.set("from_date", fromDate);
    fd.set("to_date", toDate);
    fd.set("note", note);
    const res = await addStaffAway(fd);
    setSaving(false);
    if (res?.error) { setError(res.error); return; }
    setNote("");
    router.refresh();
  }

  async function handleRemove(id: string) {
    setRemoving(id);
    setError(null);
    const res = await removeStaffAway(id);
    setRemoving(null);
    if (res?.error) { setError(res.error); return; }
    router.refresh();
  }

  // Which staff this user can manage
  const manageableStaff = isCommittee ? staffList : staffList.filter((s) => s.id === currentUserId);

  return (
    <div className="cal-no-print space-y-4">
      {/* Current / upcoming away entries */}
      {relevantEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No current or upcoming absences recorded.</p>
      ) : (
        <div className="space-y-1.5">
          {relevantEntries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{e.staffName}</span>
                <span className="block text-warning lg:ml-2 lg:inline">
                  {formatDate(e.fromDate)}{e.fromDate !== e.toDate ? ` – ${formatDate(e.toDate)}` : ""}
                </span>
                {e.note && <span className="block text-xs text-muted-foreground lg:ml-2 lg:inline">· {e.note}</span>}
              </div>
              {(isCommittee || e.staffId === currentUserId) && (
                <button
                  onClick={() => handleRemove(e.id)}
                  disabled={removing === e.id}
                  title="Remove"
                  className="touch flex w-11 shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive lg:w-9"
                >
                  {removing === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Past entries (collapsed) */}
      {pastEntries.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">{pastEntries.length} past {pastEntries.length === 1 ? "entry" : "entries"}</summary>
          <div className="mt-1.5 space-y-1">
            {pastEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                <span>{e.staffName} · {formatDate(e.fromDate)}{e.fromDate !== e.toDate ? ` – ${formatDate(e.toDate)}` : ""}{e.note ? ` · ${e.note}` : ""}</span>
                {(isCommittee || e.staffId === currentUserId) && (
                  <button onClick={() => handleRemove(e.id)} disabled={removing === e.id} className="text-muted-foreground hover:text-destructive">
                    {removing === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add form */}
      {manageableStaff.length > 0 && (
        <form onSubmit={handleAdd} className="border-t pt-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Record absence</p>
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            {isCommittee && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Staff member</label>
                <select
                  value={selectedStaff}
                  onChange={(e) => setSelectedStaff(e.target.value)}
                  className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm lg:w-auto"
                  required
                >
                  {manageableStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }}
                className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm lg:w-auto"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
                className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm lg:w-auto"
                required
              />
            </div>
            <div className="space-y-1 lg:min-w-0 lg:flex-1">
              <label className="text-xs text-muted-foreground">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Holiday"
                className="touch w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={saving} className="touch w-full lg:w-auto">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Add"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}
