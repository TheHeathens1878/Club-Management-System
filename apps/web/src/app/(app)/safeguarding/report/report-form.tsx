"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";

import { Textarea } from "@/components/ui/field";
import { Label } from "@/components/ui/input";

import { reportConcern, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type PersonOption = { id: string; name: string };

/**
 * Reporting is open to anyone signed in (SG-3). The reporter never gets read
 * access to the case in return: what they get back is a reference, and
 * "My reports" shows the status against it.
 */
export function ReportForm({ people }: { people: PersonOption[] }) {
  const [state, action, pending] = useActionState(reportConcern, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="narrative">What happened? *</Label>
        <Textarea
          id="narrative"
          name="narrative"
          rows={6}
          required
          placeholder="What you saw or were told, when, and who was there. Write it in your own words — this text is kept exactly as you write it."
        />
      </div>

      {people.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="subject_person_id">Who is this about? (optional)</Label>
            <select
              id="subject_person_id"
              name="subject_person_id"
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm lg:h-10"
              defaultValue=""
            >
              <option value="">Not saying / not listed</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reported_person_id">Who is the concern about? (optional)</Label>
            <select
              id="reported_person_id"
              name="reported_person_id"
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm lg:h-10"
              defaultValue=""
            >
              <option value="">Not saying / not listed</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-2"
      >
        <Send className="h-4 w-4" /> Send report
      </button>
    </form>
  );
}
