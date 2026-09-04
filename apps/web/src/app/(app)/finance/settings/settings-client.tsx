"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";

import { revokeMandate, saveFinanceSettings, type ActionState } from "../actions";

const EMPTY: ActionState = {};

export type MandateRow = {
  id: string;
  member_no: string;
  lead_name: string;
  status: string;
  card: string;
  covers_fines: boolean;
  consented_at: string | null;
};

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>;
  if (state.notice)
    return <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.notice}</p>;
  return null;
}

const SETTINGS: { key: string; label: string }[] = [
  { key: "finance.xero_account_membership", label: "Xero account — membership fees" },
  { key: "finance.xero_account_subs", label: "Xero account — subs" },
  { key: "finance.xero_account_fine", label: "Xero account — fines" },
  { key: "finance.xero_account_hire", label: "Xero account — function room hire" },
  { key: "finance.xero_account_other", label: "Xero account — other" },
  { key: "finance.xero_tax_type", label: "Tax type (e.g. No VAT)" },
];

export function SettingsClient({
  settings,
  mandates,
}: {
  settings: Record<string, string>;
  mandates: MandateRow[];
}) {
  const [saveState, saveAction, saving] = useActionState(saveFinanceSettings, EMPTY);
  const [revokeState, revokeAction] = useActionState(revokeMandate, EMPTY);

  return (
    <div className="space-y-6">
      <form action={saveAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map((setting) => (
            <div key={setting.key} className="space-y-1.5">
              <Label htmlFor={setting.key}>{setting.label}</Label>
              <Input id={setting.key} name={setting.key} defaultValue={settings[setting.key] ?? ""} />
            </div>
          ))}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        <Feedback state={saveState} />
      </form>

      <div className="space-y-2">
        <p className="text-sm font-medium">Cards on file</p>
        <p className="text-xs text-muted-foreground">
          Stored SumUp instruments per membership. &ldquo;Covers fines&rdquo; is the lead member&apos;s recorded
          pre-authorisation for one-off fines; revoking stops all future collections from the card.
        </p>
        {mandates.length === 0 && <p className="text-sm text-muted-foreground">No cards on file yet.</p>}
        <ul className="space-y-1">
          {mandates.map((mandate) => (
            <li key={mandate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{mandate.member_no}</span>
                <span className="font-medium">{mandate.lead_name}</span>
                <span className="text-xs text-muted-foreground">{mandate.card}</span>
                <Badge variant={mandate.status === "active" ? "success" : "muted"}>{mandate.status}</Badge>
                {mandate.covers_fines && <Badge variant="outline">covers fines</Badge>}
              </span>
              {(mandate.status === "active" || mandate.status === "pending") && (
                <form action={revokeAction}>
                  <input type="hidden" name="mandate_id" value={mandate.id} />
                  <button type="submit" className="text-xs text-muted-foreground underline hover:text-destructive">
                    revoke
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <Feedback state={revokeState} />
      </div>
    </div>
  );
}
