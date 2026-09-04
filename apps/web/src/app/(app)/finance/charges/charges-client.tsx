"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { CHARGE_KIND_LABELS, CHARGE_STATUS_LABELS, chargeRef, formatMemberNo } from "@/lib/finance-format";

import {
  cancelAgreement,
  collectFromStoredCard,
  deleteCharge,
  enrollHouseholdAction,
  raiseChargeAction,
  recordChargePayment,
  voidCharge,
  waiveCharge,
  type ActionState,
} from "../actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm";

export type ChargeRow = {
  id: string;
  charge_no: number;
  account_id: string;
  member_no: number;
  lead_name: string;
  person_name: string | null;
  kind: string;
  description: string;
  plan_name: string | null;
  amount_pence: number;
  paid_pence: number;
  due_on: string;
  status: string;
  waived_reason: string | null;
  mandate: boolean;
};

export type AgreementRow = {
  id: string;
  member_no: number;
  lead_name: string;
  plan_name: string;
  amount_pence: number;
  schedule: string;
  status: string;
  next_charge_on: string | null;
  months_total: number | null;
  months_charged: number;
  auto_collect: boolean;
};

export type PickerOption = { id: string; name: string };

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

function statusVariant(status: string): "success" | "muted" | "destructive" | "outline" {
  if (status === "paid") return "success";
  if (status === "pending") return "destructive";
  return "muted";
}

export function ChargesClient({
  charges,
  agreements,
  people,
  accounts,
  plans,
  filterStatus,
  isSuperUser,
}: {
  charges: ChargeRow[];
  agreements: AgreementRow[];
  people: PickerOption[];
  accounts: PickerOption[];
  plans: PickerOption[];
  filterStatus: string;
  isSuperUser: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [raiseState, raiseAction, raising] = useActionState(raiseChargeAction, EMPTY);
  const [waiveState, waiveAction] = useActionState(waiveCharge, EMPTY);
  const [voidState, voidAction] = useActionState(voidCharge, EMPTY);
  const [collectState, collectAction, collecting] = useActionState(collectFromStoredCard, EMPTY);
  const [payState, payAction] = useActionState(recordChargePayment, EMPTY);
  const [agreementState, agreementAction, startingAgreement] = useActionState(enrollHouseholdAction, EMPTY);
  const [cancelState, cancelAction] = useActionState(cancelAgreement, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteCharge, EMPTY);

  function setStatusFilter(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (status) params.set("status", status);
    else params.delete("status");
    router.push(`/finance/charges?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {["", "pending", "paid", "waived", "void"].map((status) => (
          <button
            key={status || "all"}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filterStatus === status ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          >
            {status === "" ? "All" : CHARGE_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {charges.length === 0 && <p className="text-sm text-muted-foreground">No charges match.</p>}
        {charges.map((charge) => {
          const expanded = open === charge.id;
          const outstanding = Math.max(0, charge.amount_pence - charge.paid_pence);
          return (
            <div key={charge.id} className="rounded-lg border">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : charge.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{chargeRef(charge.charge_no)}</span>
                    <span className="text-sm font-medium">{charge.description}</span>
                    <Badge variant={statusVariant(charge.status)}>{CHARGE_STATUS_LABELS[charge.status] ?? charge.status}</Badge>
                    <Badge variant="outline">{CHARGE_KIND_LABELS[charge.kind] ?? charge.kind}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatMemberNo(charge.member_no)} — {charge.lead_name}
                    {charge.person_name && charge.person_name !== charge.lead_name ? ` (for ${charge.person_name})` : ""}
                    {" · due "}
                    {charge.due_on}
                  </p>
                </div>
                <span className="text-sm tabular-nums">
                  {charge.paid_pence > 0 && charge.status === "pending"
                    ? `${money(outstanding)} of ${money(charge.amount_pence)}`
                    : money(charge.amount_pence)}
                </span>
              </button>

              {expanded && (
                <div className="space-y-3 border-t p-3">
                  {charge.waived_reason && (
                    <p className="text-xs text-muted-foreground">Waived: {charge.waived_reason}</p>
                  )}
                  {charge.status === "pending" && (
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={payAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="charge_id" value={charge.id} />
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`amt-${charge.id}`}>Record payment (£)</Label>
                          <Input
                            id={`amt-${charge.id}`}
                            name="amount"
                            inputMode="decimal"
                            defaultValue={(outstanding / 100).toFixed(2)}
                            className="w-28"
                          />
                        </div>
                        <select name="method" className={`${selectClass} w-auto`} defaultValue="cash">
                          <option value="cash">Cash</option>
                          <option value="card">Card (terminal)</option>
                          <option value="bank_transfer">Bank transfer</option>
                          <option value="other">Other</option>
                        </select>
                        <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary">
                          Record
                        </button>
                      </form>
                      {charge.mandate && (
                        <form action={collectAction}>
                          <input type="hidden" name="charge_id" value={charge.id} />
                          <button
                            type="submit"
                            disabled={collecting}
                            className="min-h-[40px] rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {collecting ? "Collecting…" : "Collect from stored card"}
                          </button>
                        </form>
                      )}
                      <form action={waiveAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="charge_id" value={charge.id} />
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`waive-${charge.id}`}>Waive (reason required)</Label>
                          <Input id={`waive-${charge.id}`} name="reason" placeholder="Why is this waived?" className="w-56" />
                        </div>
                        <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary">
                          Waive
                        </button>
                      </form>
                      {charge.paid_pence === 0 && (
                        <form action={voidAction}>
                          <input type="hidden" name="charge_id" value={charge.id} />
                          <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium text-destructive hover:bg-secondary">
                            Void
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                  {isSuperUser && charge.paid_pence === 0 && (
                    <form
                      action={deleteAction}
                      onSubmit={(event) => {
                        if (!confirm(`Delete ${chargeRef(charge.charge_no)} outright? The deletion is audited.`))
                          event.preventDefault();
                      }}
                    >
                      <input type="hidden" name="charge_id" value={charge.id} />
                      <button type="submit" className="text-xs text-muted-foreground underline hover:text-destructive">
                        Delete this charge (super user)
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Feedback state={payState} />
        <Feedback state={collectState} />
        <Feedback state={waiveState} />
        <Feedback state={voidState} />
        <Feedback state={deleteState} />
      </div>

      <form action={raiseAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">Raise a charge</p>
        <p className="text-xs text-muted-foreground">
          Pick the person it is for — a yellow or red card fine picks the player; the charge lands on
          their lead member. Use a plan for a set price, or leave the plan blank and describe a
          bespoke charge.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="raise-person">Who is it for? *</Label>
            <select id="raise-person" name="person_id" className={selectClass} defaultValue="" required>
              <option value="" disabled>Pick a member…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-plan">Plan (optional)</Label>
            <select id="raise-plan" name="plan_id" className={selectClass} defaultValue="">
              <option value="">— bespoke —</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-description">Description (bespoke, or override)</Label>
            <Input id="raise-description" name="description" placeholder="e.g. Kit replacement" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-amount">Amount £ (bespoke, or override)</Label>
            <Input id="raise-amount" name="amount" inputMode="decimal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-due">Due date</Label>
            <Input id="raise-due" name="due_on" type="date" />
          </div>
        </div>
        <button
          type="submit"
          disabled={raising}
          className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {raising ? "Raising…" : "Raise charge"}
        </button>
        <Feedback state={raiseState} />
      </form>

      <div className="space-y-3">
        <p className="text-sm font-medium">Agreements (monthly & annual collections)</p>
        <div className="space-y-2">
          {agreements.length === 0 && (
            <p className="text-sm text-muted-foreground">No live agreements yet.</p>
          )}
          {agreements.map((agreement) => (
            <div key={agreement.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{formatMemberNo(agreement.member_no)}</span>
                  <span className="font-medium">{agreement.lead_name}</span>
                  <span>· {agreement.plan_name}</span>
                  {agreement.auto_collect && <Badge variant="outline">auto-collect</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {money(agreement.amount_pence)} {agreement.schedule === "monthly" ? "a month" : "a year"}
                  {agreement.months_total ? ` · ${agreement.months_charged}/${agreement.months_total} collected` : ""}
                  {agreement.next_charge_on ? ` · next ${agreement.next_charge_on}` : ""}
                </p>
              </div>
              <form action={cancelAction}>
                <input type="hidden" name="agreement_id" value={agreement.id} />
                <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium text-destructive hover:bg-secondary">
                  Cancel
                </button>
              </form>
            </div>
          ))}
          <Feedback state={cancelState} />
        </div>

        <form action={agreementAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-4">
          <div className="min-w-0 grow space-y-1">
            <Label className="text-xs" htmlFor="agreement-account">Enrol a membership for this season</Label>
            <select id="agreement-account" name="account_id" className={selectClass} defaultValue="" required>
              <option value="" disabled>Pick a membership…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-medium">How will they pay?</p>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="monthly" defaultChecked className="h-4 w-4" />
              Monthly — membership now, subs each 1st to 1 May
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="upfront" className="h-4 w-4" />
              Up front — the same total, one payment
            </label>
          </div>
          <button
            type="submit"
            disabled={startingAgreement}
            className="min-h-[40px] rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {startingAgreement ? "Enrolling…" : "Enrol"}
          </button>
          <p className="w-full text-xs text-muted-foreground">
            Individual or family is decided automatically from who is playing. The fees come from{" "}
            <a href="/finance/fees" className="underline">Finance → Fees</a>.
          </p>
          <Feedback state={agreementState} />
        </form>
      </div>
    </div>
  );
}
