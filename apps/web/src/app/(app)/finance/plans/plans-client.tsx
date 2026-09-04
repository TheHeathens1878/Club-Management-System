"use client";

import { useState, useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { CHARGE_KIND_LABELS } from "@/lib/finance-format";

import { deleteFeePlan, saveFeePlan, setFeePlanActive, type ActionState } from "../actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm";

export type FeePlanRow = {
  id: string;
  name: string;
  description: string | null;
  cohort: string | null;
  kind: string;
  scope: string | null;
  amount_pence: number;
  schedule: string;
  months_total: number | null;
  active: boolean;
};

function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>;
  if (state.notice)
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.notice}</p>;
  return null;
}

function PlanForm({ plan, onDone }: { plan?: FeePlanRow; onDone?: () => void }) {
  const [state, action, saving] = useActionState(saveFeePlan, EMPTY);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-dashed p-4">
      <p className="text-sm font-medium">{plan ? `Edit — ${plan.name}` : "Add a plan"}</p>
      {plan && <input type="hidden" name="plan_id" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${plan?.id ?? "new"}`}>Name *</Label>
          <Input id={`name-${plan?.id ?? "new"}`} name="name" defaultValue={plan?.name} required placeholder="e.g. Veterans membership" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`amount-${plan?.id ?? "new"}`}>Amount (£) *</Label>
          <Input
            id={`amount-${plan?.id ?? "new"}`}
            name="amount"
            inputMode="decimal"
            defaultValue={plan ? (plan.amount_pence / 100).toFixed(2) : ""}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`kind-${plan?.id ?? "new"}`}>Kind</Label>
          <select id={`kind-${plan?.id ?? "new"}`} name="kind" className={selectClass} defaultValue={plan?.kind ?? "membership"}>
            <option value="membership">Membership fee</option>
            <option value="subs">Subs</option>
            <option value="fine">Fine</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`scope-${plan?.id ?? "new"}`}>Scope</Label>
          <select id={`scope-${plan?.id ?? "new"}`} name="scope" className={selectClass} defaultValue={plan?.scope ?? ""}>
            <option value="">—</option>
            <option value="individual">Individual</option>
            <option value="family">Family</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`schedule-${plan?.id ?? "new"}`}>Schedule</Label>
          <select id={`schedule-${plan?.id ?? "new"}`} name="schedule" className={selectClass} defaultValue={plan?.schedule ?? "one_off"}>
            <option value="one_off">One-off (up-front)</option>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`months-${plan?.id ?? "new"}`}>Months (monthly plans, blank = open-ended)</Label>
          <Input
            id={`months-${plan?.id ?? "new"}`}
            name="months_total"
            inputMode="numeric"
            defaultValue={plan?.months_total ?? ""}
            placeholder="e.g. 10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cohort-${plan?.id ?? "new"}`}>Cohort (free text)</Label>
          <Input id={`cohort-${plan?.id ?? "new"}`} name="cohort" defaultValue={plan?.cohort ?? ""} placeholder="e.g. U7–U11, Veterans, Social" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`description-${plan?.id ?? "new"}`}>Description</Label>
          <Input id={`description-${plan?.id ?? "new"}`} name="description" defaultValue={plan?.description ?? ""} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : plan ? "Save changes" : "Create plan"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-xs text-muted-foreground underline">
            Close
          </button>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function PlansClient({ plans }: { plans: FeePlanRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [activeState, activeAction] = useActionState(setFeePlanActive, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteFeePlan, EMPTY);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
        {plans.map((plan) => (
          <div key={plan.id} className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{plan.name}</span>
                  <Badge variant={plan.active ? "success" : "muted"}>{plan.active ? "Active" : "Inactive"}</Badge>
                  <Badge variant="outline">{CHARGE_KIND_LABELS[plan.kind] ?? plan.kind}</Badge>
                  {plan.scope && <Badge variant="outline">{plan.scope}</Badge>}
                  {plan.cohort && <Badge variant="outline">{plan.cohort}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {money(plan.amount_pence)}
                  {plan.schedule === "monthly"
                    ? ` a month${plan.months_total ? ` for ${plan.months_total} months` : ""}`
                    : plan.schedule === "annual"
                      ? " a year"
                      : " one-off"}
                  {plan.description ? ` · ${plan.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(editing === plan.id ? null : plan.id)}
                  className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary"
                >
                  Edit
                </button>
                <form action={activeAction}>
                  <input type="hidden" name="plan_id" value={plan.id} />
                  <input type="hidden" name="active" value={plan.active ? "false" : "true"} />
                  <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary">
                    {plan.active ? "Deactivate" : "Activate"}
                  </button>
                </form>
                <form
                  action={deleteAction}
                  onSubmit={(event) => {
                    if (!confirm(`Delete "${plan.name}"? A plan in use is refused.`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="plan_id" value={plan.id} />
                  <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium text-destructive hover:bg-secondary">
                    Delete
                  </button>
                </form>
              </div>
            </div>
            {editing === plan.id && (
              <div className="border-t p-3">
                <PlanForm plan={plan} onDone={() => setEditing(null)} />
              </div>
            )}
          </div>
        ))}
        <Feedback state={activeState} />
        <Feedback state={deleteState} />
      </div>

      <PlanForm />
    </div>
  );
}
