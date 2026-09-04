"use client";

import { useMemo, useState, useActionState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { formatCardRef, formatMemberNo } from "@/lib/finance-format";

import {
  addPersonToAccount,
  createAccountFor,
  issueNumbers,
  removePersonFromAccount,
  setAccountStatus,
  type ActionState,
} from "../actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm";

export type AccountRow = {
  account_id: string;
  member_no: number;
  lead_person_id: string;
  lead_name: string;
  status: string;
  balance_pence: number;
  overdue_pence: number;
  people: { person_id: string; letter: string; removed: boolean; name: string }[];
};

export type PreviewRow = {
  lead_person_id: string;
  lead_name: string;
  basis: string;
  household: { person_id: string; name: string }[];
};

export type PersonOption = { id: string; name: string };

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

export function MembersClient({
  accounts,
  preview,
  unnumbered,
}: {
  accounts: AccountRow[];
  preview: PreviewRow[];
  unnumbered: PersonOption[];
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [issueState, issueAction, issuing] = useActionState(issueNumbers, EMPTY);
  const [rowState, rowAction] = useActionState(setAccountStatus, EMPTY);
  const [addState, addAction] = useActionState(addPersonToAccount, EMPTY);
  const [removeState, removeAction] = useActionState(removePersonFromAccount, EMPTY);
  const [createState, createAction, creating] = useActionState(createAccountFor, EMPTY);

  // Reverse member search: a hit on ANY name under a number surfaces the
  // lead's row. "jones" finds Stephanie and shows 00002 — Adam Wareing.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (account) =>
        account.lead_name.toLowerCase().includes(q) ||
        formatMemberNo(account.member_no).includes(q) ||
        account.people.some((person) => person.name.toLowerCase().includes(q)),
    );
  }, [accounts, search]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a member, a child, a partner or a number…"
          aria-label="Search memberships"
        />
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No membership matches that search.</p>
        )}
        <div className="space-y-2">
          {filtered.map((account) => {
            const open = expanded === account.account_id;
            return (
              <div key={account.account_id} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : account.account_id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-secondary/40"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMemberNo(account.member_no)}
                    </span>
                    <span className="text-sm font-medium">{account.lead_name}</span>
                    <Badge variant="outline">{account.people.filter((p) => !p.removed).length} on the number</Badge>
                    {account.status !== "active" && <Badge variant="muted">{account.status}</Badge>}
                    {account.overdue_pence > 0 && <Badge variant="destructive">overdue {money(account.overdue_pence)}</Badge>}
                  </div>
                  <span className={`text-sm tabular-nums ${account.balance_pence > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {account.balance_pence > 0 ? `${money(account.balance_pence)} owing` : "settled"}
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 border-t p-3">
                    <ul className="space-y-1">
                      {account.people.map((person) => (
                        <li key={person.person_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {formatCardRef(account.member_no, person.letter)}
                            </span>
                            <span className={person.removed ? "line-through opacity-60" : ""}>{person.name}</span>
                            {person.person_id === account.lead_person_id && <Badge variant="outline">lead · bill-payer</Badge>}
                            {person.removed && <Badge variant="muted">removed</Badge>}
                          </span>
                          {!person.removed && person.person_id !== account.lead_person_id && (
                            <form action={removeAction}>
                              <input type="hidden" name="account_id" value={account.account_id} />
                              <input type="hidden" name="person_id" value={person.person_id} />
                              <button type="submit" className="text-xs text-muted-foreground underline hover:text-destructive">
                                remove
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/finance/charges?account=${account.account_id}`} className="text-xs font-medium underline">
                        Charges & payments for this membership
                      </Link>
                      <Link href={`/people/${account.lead_person_id}`} className="text-xs text-muted-foreground underline">
                        Lead's member record
                      </Link>
                    </div>

                    <form action={addAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="account_id" value={account.account_id} />
                      <div className="min-w-0 grow space-y-1">
                        <Label htmlFor={`add-${account.account_id}`} className="text-xs">Add a person to this number</Label>
                        <select id={`add-${account.account_id}`} name="person_id" className={selectClass} defaultValue="">
                          <option value="" disabled>Pick a person…</option>
                          {unnumbered.map((person) => (
                            <option key={person.id} value={person.id}>{person.name}</option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary">
                        Add (next letter)
                      </button>
                    </form>

                    <form action={rowAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="account_id" value={account.account_id} />
                      <select name="status" className={`${selectClass} w-auto`} defaultValue={account.status}>
                        <option value="active">active</option>
                        <option value="lapsed">lapsed</option>
                        <option value="closed">closed</option>
                      </select>
                      <button type="submit" className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary">
                        Set status
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Feedback state={rowState} />
        <Feedback state={addState} />
        <Feedback state={removeState} />
      </div>

      {preview.length > 0 && (
        <form action={issueAction} className="space-y-3 rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">Issue membership numbers</p>
          <p className="text-xs text-muted-foreground">
            Un-numbered households, alphabetical by lead member — numbers are issued in exactly this
            order. Untick anything that should not be numbered (test entries, duplicates).
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {preview.map((row) => (
              <li key={row.lead_person_id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="lead_id"
                  value={row.lead_person_id}
                  defaultChecked
                  className="mt-1 h-4 w-4"
                  id={`lead-${row.lead_person_id}`}
                />
                <label htmlFor={`lead-${row.lead_person_id}`} className="min-w-0">
                  <span className="font-medium">{row.lead_name}</span>
                  <span className="text-muted-foreground"> — {row.basis}</span>
                  {row.household.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      with {row.household.map((member) => member.name).join(", ")}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            disabled={issuing}
            className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {issuing ? "Issuing…" : "Issue numbers (alphabetical)"}
          </button>
          <Feedback state={issueState} />
        </form>
      )}

      <form action={createAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-4">
        <div className="min-w-0 grow space-y-1">
          <Label htmlFor="new-lead" className="text-xs">Issue a single number (new lead member)</Label>
          <select id="new-lead" name="person_id" className={selectClass} defaultValue="">
            <option value="" disabled>Pick an adult…</option>
            {unnumbered.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="min-h-[40px] rounded-md border px-3 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          Issue next number
        </button>
        <Feedback state={createState} />
      </form>
    </div>
  );
}
