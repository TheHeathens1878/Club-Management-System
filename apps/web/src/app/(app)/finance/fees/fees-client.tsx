"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";

import { saveFees, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type SystemPlan = {
  id: string;
  system_key: string;
  name: string;
  amount_pence: number;
  active: boolean;
};

const BOX_LABELS: Record<string, string> = {
  membership_individual: "Membership — Individual (per season)",
  membership_family: "Membership — Family (per season)",
  subs_monthly_individual: "Monthly subs — Individual",
  subs_monthly_family: "Monthly subs — Family",
  fine_yellow: "Yellow card fine",
  fine_red: "Red card fine",
};

const BOX_ORDER = [
  "membership_individual",
  "membership_family",
  "subs_monthly_individual",
  "subs_monthly_family",
  "fine_yellow",
  "fine_red",
];

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>;
  if (state.notice)
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.notice}</p>;
  return null;
}

export function FeesClient({ plans }: { plans: SystemPlan[] }) {
  const [state, action, saving] = useActionState(saveFees, EMPTY);
  const byKey = new Map(plans.map((plan) => [plan.system_key, plan]));
  const anyInactive = plans.some((plan) => !plan.active);

  return (
    <form action={action} className="space-y-4">
      {anyInactive && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Some fees are not active yet — members cannot enrol until they are. Saving activates all
          six.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BOX_ORDER.map((key) => {
          const plan = byKey.get(key);
          if (!plan) return null;
          return (
            <div key={key} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`fee-${key}`}>{BOX_LABELS[key] ?? plan.name}</Label>
                {!plan.active && <Badge variant="muted">inactive</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">£</span>
                <Input
                  id={`fee-${key}`}
                  name={key}
                  inputMode="decimal"
                  defaultValue={(plan.amount_pence / 100).toFixed(2)}
                  className="w-28"
                />
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="submit"
        disabled={saving}
        className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save & activate fees"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
