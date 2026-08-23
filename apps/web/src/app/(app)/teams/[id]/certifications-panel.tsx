"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import {
  addCertification,
  grantExemption,
  revokeCertification,
  revokeExemption,
  verifyCertification,
  type ActionState,
} from "./certification-actions";

const EMPTY: ActionState = {};
const selectClass = "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export type StaffMember = {
  personId: string;
  name: string;
  role: string;
  dbs: string;
  safeguarding: string;
};

export type CertificationRow = {
  id: string;
  person_id: string;
  type: string;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  verified_at: string | null;
  revoked_at: string | null;
};

export type ExemptionRow = {
  id: string;
  person_id: string;
  reason: string;
  expires_on: string;
  revoked_at: string | null;
};

function statusVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  if (status === "valid") return "success";
  if (status === "expiring") return "warning";
  if (status === "expired") return "destructive";
  return "muted";
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

/**
 * SG-6 for one team: who works with the children here, what paperwork they
 * hold, and the lead's 30-day escape hatch. Everything writes through the
 * user's own client, so the database's role checks are the ones that count —
 * a committee sign-in that does not hold `safeguarding_lead` will be refused
 * by the exemption policy, and that refusal is shown.
 */
export function CertificationsPanel({
  teamId,
  staff,
  certifications,
  exemptions,
  isLead,
}: {
  teamId: string;
  staff: StaffMember[];
  certifications: CertificationRow[];
  exemptions: ExemptionRow[];
  isLead: boolean;
}) {
  const [addState, addAction, adding] = useActionState(addCertification, EMPTY);
  const [verifyState, verifyAction] = useActionState(verifyCertification, EMPTY);
  const [revokeState, revokeAction] = useActionState(revokeCertification, EMPTY);
  const [grantState, grantAction, granting] = useActionState(grantExemption, EMPTY);
  const [revokeExState, revokeExAction] = useActionState(revokeExemption, EMPTY);

  return (
    <div className="space-y-6">
      {staff.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No coaches, assistants or managers are recorded against this team.
        </p>
      )}

      {staff.map((member) => {
        const held = certifications.filter((c) => c.person_id === member.personId);
        const live = exemptions.filter((e) => e.person_id === member.personId && !e.revoked_at);
        return (
          <div key={member.personId} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.role.replace("_", " ")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(member.dbs)}>DBS: {member.dbs}</Badge>
                <Badge variant={statusVariant(member.safeguarding)}>Safeguarding: {member.safeguarding}</Badge>
              </div>
            </div>

            {held.length > 0 && (
              <div className="mt-3 space-y-2">
                {held.map((cert) => (
                  <div
                    key={cert.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-medium">{cert.type.replace(/_/g, " ")}</span>
                      {cert.reference && <span className="text-muted-foreground"> · {cert.reference}</span>}
                      <span className="text-muted-foreground">
                        {" "}
                        · expires {cert.expires_on ?? "no expiry"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {cert.revoked_at ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : cert.verified_at ? (
                        <Badge variant="success">verified</Badge>
                      ) : (
                        <Badge variant="warning">unverified</Badge>
                      )}
                      {!cert.revoked_at && !cert.verified_at && (
                        <form action={verifyAction}>
                          <input type="hidden" name="team_id" value={teamId} />
                          <input type="hidden" name="certification_id" value={cert.id} />
                          <button type="submit" className="rounded border px-2 py-1 hover:bg-secondary">
                            Verify
                          </button>
                        </form>
                      )}
                      {!cert.revoked_at && (
                        <form action={revokeAction}>
                          <input type="hidden" name="team_id" value={teamId} />
                          <input type="hidden" name="certification_id" value={cert.id} />
                          <button type="submit" className="rounded border px-2 py-1 hover:bg-secondary">
                            Revoke
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {live.length > 0 && (
              <div className="mt-3 space-y-2">
                {live.map((exemption) => (
                  <div
                    key={exemption.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    <span>
                      Exempt until {exemption.expires_on} — {exemption.reason}
                    </span>
                    {isLead && (
                      <form action={revokeExAction}>
                        <input type="hidden" name="team_id" value={teamId} />
                        <input type="hidden" name="exemption_id" value={exemption.id} />
                        <button type="submit" className="rounded border border-amber-300 px-2 py-1 hover:bg-amber-100">
                          Revoke
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <Feedback state={verifyState} />
      <Feedback state={revokeState} />
      <Feedback state={revokeExState} />

      {staff.length > 0 && (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">Record a certification</p>
          <form action={addAction} className="mt-3 space-y-3">
            <input type="hidden" name="team_id" value={teamId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cert-person">Person</Label>
                <select id="cert-person" name="person_id" className={selectClass} defaultValue="">
                  <option value="">Choose…</option>
                  {staff.map((m) => (
                    <option key={m.personId} value={m.personId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-type">Type</Label>
                <select id="cert-type" name="type" className={selectClass} defaultValue="fa_dbs">
                  <option value="fa_dbs">FA DBS</option>
                  <option value="safeguarding_children">Safeguarding children</option>
                  <option value="first_aid">First aid</option>
                  <option value="coaching_badge">Coaching badge</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-reference">Reference</Label>
                <Input id="cert-reference" name="reference" placeholder="Certificate number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-issued">Issued on</Label>
                <Input id="cert-issued" name="issued_on" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-expires">Expires on</Label>
                <Input id="cert-expires" name="expires_on" type="date" />
              </div>
            </div>
            <Feedback state={addState} />
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              Record certification
            </button>
          </form>
        </div>
      )}

      {isLead && staff.length > 0 && (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">Grant an exemption (safeguarding lead)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lets a named person work with this team for at most 30 days while paperwork clears. The
            grant is recorded against you.
          </p>
          <form action={grantAction} className="mt-3 space-y-3">
            <input type="hidden" name="team_id" value={teamId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exempt-person">Person</Label>
                <select id="exempt-person" name="person_id" className={selectClass} defaultValue="">
                  <option value="">Choose…</option>
                  {staff.map((m) => (
                    <option key={m.personId} value={m.personId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exempt-expires">Expires on</Label>
                <Input id="exempt-expires" name="expires_on" type="date" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exempt-reason">Reason</Label>
              <Textarea id="exempt-reason" name="reason" rows={2} required />
            </div>
            <Feedback state={grantState} />
            <button
              type="submit"
              disabled={granting}
              className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-60"
            >
              Grant exemption
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
