"use client";

import { useState, useTransition } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addNonUserStaff, removeNonUserStaff } from "@/app/(app)/super-users/actions";

type NonUserStaff = { id: string; name: string };

export function NonUserStaffClient({ initial }: { initial: NonUserStaff[] }) {
  const [list, setList] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await addNonUserStaff(name.trim());
        setList((prev) => [...prev, { id: crypto.randomUUID(), name: name.trim() }]);
        setName("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add");
      }
    });
  }

  function handleRemove(id: string, staffName: string) {
    if (!confirm(`Remove "${staffName}" from staff list?`)) return;
    startTransition(async () => {
      try {
        await removeNonUserStaff(id);
        setList((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Staff member name"
          disabled={isPending}
          className="max-w-xs"
        />
        <Button type="submit" disabled={isPending || !name.trim()} size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Add
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No external staff added yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{s.name}</span>
              <button
                onClick={() => handleRemove(s.id, s.name)}
                disabled={isPending}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
