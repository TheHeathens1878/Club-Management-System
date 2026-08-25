"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";

import {
  cancelSubscription,
  createPlan,
  recordPayment,
  setPlanActive,
  type ActionState,
} from "./actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  amount_pence: number;
  billing: string;
  instalments: number | null;
  active: boolean;
  season_name: string;
  team_name: string | null;
};

export type ArrearsRow = {
  subscription_id: string;
  person_name: string | null;
  plan_name: string;
  team_name: string | null;
  status: string;
  amount_due_pence: number;
  paid_pence: number;
  outstanding_pence: number;
  days_since_start: number;
};

export type Option = { id: string; name: string };

export function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

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

export function PlansPanel({
  plans,
  seasons,
  teams,
}: {
  plans: PlanRow[];
  seasons: Option[];
  teams: Option[];
}) {
  const [createState, createAction, creating] = useActionState(createPlan, EMPTY);
  const [activeState, activeAction] = useActionState(setPlanActive, EMPTY);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{plan.name}</span>
                <Badge variant={plan.active ? "success" : "muted"}>{plan.active ? "Active" : "Closed"}</Badge>
                <Badge variant="outline">{plan.billing.replace("_", " ")}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {money(plan.amount_pence)}
                {plan.instalments ? ` · ${plan.instalments} instalments` : ""} · {plan.season_name}
                {plan.team_name ? ` · ${plan.team_name}` : " · club-wide"}
              </p>
            </div>
            <form action={activeAction} className="w-full lg:w-auto">
              <input type="hidden" name="plan_id" value={plan.id} />
              <input type="hidden" name="active" value={plan.active ? "false" : "true"} />
              <button
                type="submit"
                className="min-h-[44px] w-full rounded-md border px-3 text-xs font-medium hover:bg-secondary lg:min-h-0 lg:w-auto lg:py-1.5"
              >
                {plan.active ? "Close" : "Reopen"}
              </button>
            </form>
          </div>
        ))}
        <Feedback state={activeState} />
      </div>

      <form action={createAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">Add a plan</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Name *</Label>
            <Input id="plan-name" name="name" placeholder="e.g. Under 12s season subs" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-amount">Amount (£) *</Label>
            <Input id="plan-amount" name="amount" placeholder="120.00" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-season">Season *</Label>
            <select id="plan-season" name="season_id" className={selectClass} defaultValue="">
              <option value="">Choose…</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-team">Team</Label>
            <select id="plan-team" name="team_id" className={selectClass} defaultValue="">
              <option value="">Club-wide</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-billing">Billing</Label>
            <select id="plan-billing" name="billing" className={selectClass} defaultValue="one_off">
              <option value="one_off">One off</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-instalments">Instalments (monthly only)</Label>
            <Input id="plan-instalments" name="instalments" type="number" min={1} max={12} />
          </div>
        </div>
        <Feedback state={createState} />
        <button
          type="submit"
          disabled={creating}
          className="min-h-[44px] w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 lg:min-h-0 lg:w-auto"
        >
          Create plan
        </button>
      </form>
    </div>
  );
}

export function ArrearsPanel({ rows }: { rows: ArrearsRow[] }) {
  const [payState, payAction] = useActionState(recordPayment, EMPTY);
  const [cancelState, cancelAction] = useActionState(cancelSubscription, EMPTY);

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}

      {rows.map((row) => (
        <div key={row.subscription_id} className="rounded-lg border p-3">
          {/* Member left, what is owed right — the phone keeps them on one
              line rather than dropping the money below the name. */}
          <div className="flex items-start justify-between gap-2 lg:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.person_name ?? "Club member"}</p>
              <p className="text-xs text-muted-foreground">
                {row.plan_name}
                {row.team_name ? ` · ${row.team_name}` : ""} · {row.status}
              </p>
            </div>
            <div className="flex-none text-right text-xs">
              <p className="font-medium">
                {money(row.outstanding_pence)} outstanding
              </p>
              <p className="text-muted-foreground">
                {money(row.paid_pence)} of {money(row.amount_due_pence)} · day {row.days_since_start}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
            <form
              action={payAction}
              className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end"
            >
              <input type="hidden" name="subscription_id" value={row.subscription_id} />
              <div className="space-y-1">
                <Label htmlFor={`amount-${row.subscription_id}`} className="text-xs">
                  Payment (£)
                </Label>
                <Input
                  id={`amount-${row.subscription_id}`}
                  name="amount"
                  className="h-11 w-full lg:h-9 lg:w-28"
                  placeholder="20.00"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`method-${row.subscription_id}`} className="text-xs">
                  Method
                </Label>
                <Input
                  id={`method-${row.subscription_id}`}
                  name="method"
                  className="h-11 w-full lg:h-9 lg:w-32"
                  placeholder="cash"
                />
              </div>
              <button
                type="submit"
                className="h-11 rounded-md border px-3 text-xs font-medium hover:bg-secondary lg:h-9"
              >
                Record payment
              </button>
            </form>

            <form action={cancelAction} className="flex flex-col gap-2 lg:flex-row lg:items-end">
              <input type="hidden" name="subscription_id" value={row.subscription_id} />
              <input type="hidden" name="cancel_reason" value="cancelled by the club" />
              <button
                type="submit"
                className="h-11 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-secondary lg:h-9"
              >
                Cancel subscription
              </button>
            </form>
          </div>
        </div>
      ))}

      <Feedback state={payState} />
      <Feedback state={cancelState} />
    </div>
  );
}
