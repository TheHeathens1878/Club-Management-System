"use client";

import { useActionState } from "react";

import { Input, Label } from "@/components/ui/input";

import { addSuppression, removeSuppression, savePreferences, type ActionState } from "./actions";

const EMPTY: ActionState = {};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "Text message",
  push: "Push notification",
  in_app: "In-app",
};

export type PreferenceSet = {
  personId: string;
  name: string;
  /** channel → enabled, already defaulted the way the database defaults it. */
  channels: Record<string, boolean>;
};

export type SuppressionRow = {
  id: string;
  channel: string;
  address: string;
  reason: string;
  created_at: string;
};

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function PreferencesForm({ preferences }: { preferences: PreferenceSet }) {
  const [state, action, pending] = useActionState(savePreferences, EMPTY);

  return (
    <form action={action} className="space-y-3 rounded-lg border p-4">
      <input type="hidden" name="person_id" value={preferences.personId} />
      <p className="text-sm font-medium">{preferences.name}</p>
      {/* Each channel is a 44px row on a phone — a tick box on its own is a
          10px target. Two columns from sm, as the desk has always had. */}
      <div className="grid gap-1 sm:grid-cols-2 sm:gap-2">
        {Object.entries(CHANNEL_LABELS).map(([channel, label]) => (
          <label
            key={channel}
            className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-0"
          >
            <input
              type="checkbox"
              name={`channel_${channel}`}
              defaultChecked={preferences.channels[channel] ?? false}
              className="h-4 w-4"
            />
            {label}
            {channel === "sms" && <span className="text-xs text-muted-foreground">(opt-in)</span>}
          </label>
        ))}
      </div>
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-1.5"
      >
        Save
      </button>
      <p className="text-xs text-muted-foreground">
        Turning a channel off stops reminders and marketing. Messages the club must send — a booking
        confirmation, a password link, a safeguarding notice — are transactional and still go out.
      </p>
    </form>
  );
}

export function SuppressionsPanel({ suppressions }: { suppressions: SuppressionRow[] }) {
  const [addState, addAction, adding] = useActionState(addSuppression, EMPTY);
  const [removeState, removeAction] = useActionState(removeSuppression, EMPTY);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {suppressions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing is suppressed.</p>
        )}
        {suppressions.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-mono text-xs">{row.address}</span>
              <span className="text-xs text-muted-foreground"> · {row.channel} · {row.reason}</span>
            </div>
            <form action={removeAction}>
              <input type="hidden" name="suppression_id" value={row.id} />
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center rounded border px-3 text-xs hover:bg-secondary lg:min-h-0 lg:px-2 lg:py-1"
              >
                Remove
              </button>
            </form>
          </div>
        ))}
        <Feedback state={removeState} />
      </div>

      <form action={addAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="suppress-channel">Channel</Label>
            <select
              id="suppress-channel"
              name="channel"
              defaultValue="email"
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm lg:h-10"
            >
              {Object.entries(CHANNEL_LABELS).map(([channel, label]) => (
                <option key={channel} value={channel}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suppress-address">Address</Label>
            <Input
              id="suppress-address"
              name="address"
              placeholder="name@example.com"
              required
              className="h-11 lg:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suppress-reason">Reason</Label>
            <Input
              id="suppress-reason"
              name="reason"
              placeholder="hard bounce"
              required
              className="h-11 lg:h-10"
            />
          </div>
        </div>
        <Feedback state={addState} />
        <button
          type="submit"
          disabled={adding}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto lg:min-h-0 lg:py-2"
        >
          Suppress address
        </button>
      </form>
    </div>
  );
}
