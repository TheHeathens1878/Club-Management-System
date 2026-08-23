// safeguarding-nudges — P4.3 (SG-6 tier 2). The nightly safeguarding sweep.
//
// AUTH. Scheduled only: the service-role key. `due_certification_nudges`,
// `mark_certification_nudged` and `sg1_nightly_check` are granted to
// `service_role` alone, so nothing else could run this anyway.
//
// THREE JOBS, IN ORDER
//   1. Certification expiry nudges at 90 / 30 / 7 days — one email to the
//      person, one to each safeguarding lead, then `mark_certification_nudged`
//      so the tier is never sent again (the DB owns that idempotency).
//   2. `compliance_report()` — the "non-compliant and still assigned" list. One
//      email per lead per day, if the list is non-empty.
//   3. `sg1_nightly_check()` — open conversations that violate SG-1. One email
//      per lead per day, **conversation ids only**.
//
// SG-7. Nothing here carries narrative, a concern, or a message body. The
// compliance mail is team / person / role / status lines; the SG-1 mail is a
// list of ids. Everything a lead needs to act, nothing that widens readership.

import { adminClient, type Client, json, requireServiceRole } from "../_shared/auth.ts";
import { alreadySent, enqueue, safeguardingLeads } from "../_shared/comms.ts";

type DueNudge = {
  certification_id: string;
  person_id: string;
  type: string;
  expires_on: string;
  days_before: number;
  days_left: number;
};

type ComplianceRow = {
  team_id: string;
  team_name: string;
  person_id: string;
  person_name: string;
  role: string;
  dbs_status: string;
  safeguarding_status: string;
  exemption_expires_on: string | null;
};

type Sg1Row = { conversation_id: string; type: string };

type Lead = { person_id: string; email: string };

function humanise(s: string): string {
  return s.replace(/_/g, " ");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. certification expiry
// ---------------------------------------------------------------------------

async function runCertificationNudges(admin: Client, leads: Lead[]) {
  const { data, error } = await admin.rpc("due_certification_nudges");
  if (error) return { error: error.message, due: 0, enqueued: 0, marked: 0, failures: [] as string[] };

  const rows = (data ?? []) as DueNudge[];
  let enqueued = 0;
  let marked = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const label = humanise(row.type);
    const subject = `${label} expires in ${row.days_before} days`;
    const personBody = [
      `Hello,`,
      ``,
      `Your ${label} certificate expires on ${row.expires_on} — ${row.days_left} day(s) from today.`,
      ``,
      `Please renew it and send the club the new certificate so your record can be updated. Coaches and volunteers without an in-date certificate cannot be assigned to a team with under-18s.`,
      ``,
      `Thank you,`,
      `AoM Sports Club`,
    ].join("\n");

    const toPerson = await enqueue(admin, {
      channel: "email",
      category: "reminder",
      personId: row.person_id,
      subject,
      body: personBody,
      template: `certification_expiry_${row.days_before}`,
      entity: "certifications",
      entityId: row.certification_id,
    });
    if (toPerson.ok) enqueued++;
    else failures.push(`${row.certification_id}: ${toPerson.error}`);

    const leadBody = [
      `Certification expiry due.`,
      ``,
      `Type: ${label}`,
      `Expires: ${row.expires_on} (${row.days_left} day(s))`,
      `Certification: ${row.certification_id}`,
      `Person: ${row.person_id}`,
      ``,
      `The holder has been emailed. Open the safeguarding screen to see who this is and which teams they are assigned to.`,
    ].join("\n");

    for (const lead of leads) {
      const toLead = await enqueue(admin, {
        channel: "email",
        category: "transactional",
        personId: lead.person_id,
        subject: `[Safeguarding] ${subject}`,
        body: leadBody,
        template: `certification_expiry_${row.days_before}_lead`,
        entity: "certifications",
        entityId: row.certification_id,
      });
      if (toLead.ok) enqueued++;
      else failures.push(`${row.certification_id} → lead ${lead.person_id}: ${toLead.error}`);
    }

    // Marked last: if this fails the tier simply comes round again tomorrow,
    // which is far better than a nudge that is marked but never sent.
    const { error: markError } = await admin.rpc("mark_certification_nudged", {
      p_certification_id: row.certification_id,
      p_days_before: row.days_before,
    });
    if (markError) failures.push(`mark ${row.certification_id}/${row.days_before}: ${markError.message}`);
    else marked++;
  }

  return { due: rows.length, enqueued, marked, failures };
}

// ---------------------------------------------------------------------------
// 2. compliance report
// ---------------------------------------------------------------------------

async function runComplianceReport(admin: Client, leads: Lead[]) {
  const { data, error } = await admin.rpc("compliance_report");
  if (error) return { error: error.message, rows: 0, enqueued: 0, failures: [] as string[] };

  const rows = (data ?? []) as ComplianceRow[];
  if (rows.length === 0) return { rows: 0, enqueued: 0, failures: [] as string[] };

  const day = today();
  const lines = rows.map((r) => {
    const exemption = r.exemption_expires_on ? ` — exemption to ${r.exemption_expires_on}` : "";
    return `${r.team_name} — ${r.person_name} (${humanise(r.role)}): DBS ${r.dbs_status}, safeguarding ${r.safeguarding_status}${exemption}`;
  });
  const body = [
    `Daily compliance report for ${day}.`,
    ``,
    `${rows.length} child-facing assignment(s) held by someone who is not currently compliant:`,
    ``,
    ...lines,
    ``,
    `Status meanings: valid / expiring (within 30 days) / expired / missing.`,
  ].join("\n");

  let enqueued = 0;
  const failures: string[] = [];
  for (const lead of leads) {
    if (await alreadySent(admin, "compliance", `${day}:${lead.person_id}`, "compliance_report")) continue;
    const result = await enqueue(admin, {
      channel: "email",
      category: "transactional",
      personId: lead.person_id,
      subject: `[Safeguarding] Compliance report — ${rows.length} to action`,
      body,
      template: "compliance_report",
      entity: "compliance",
      entityId: `${day}:${lead.person_id}`,
    });
    if (result.ok) enqueued++;
    else failures.push(`lead ${lead.person_id}: ${result.error}`);
  }
  return { rows: rows.length, enqueued, failures };
}

// ---------------------------------------------------------------------------
// 3. SG-1 nightly check
// ---------------------------------------------------------------------------

async function runSg1Check(admin: Client, leads: Lead[]) {
  const { data, error } = await admin.rpc("sg1_nightly_check");
  if (error) return { error: error.message, rows: 0, enqueued: 0, failures: [] as string[] };

  const rows = (data ?? []) as Sg1Row[];
  if (rows.length === 0) return { rows: 0, enqueued: 0, failures: [] as string[] };

  const day = today();
  const body = [
    `SG-1 nightly check for ${day}.`,
    ``,
    `${rows.length} open conversation(s) do not satisfy SG-1. Ids only — open each one through the safeguarding accessor, which audits the read:`,
    ``,
    ...rows.map((r) => `${r.conversation_id} (${r.type})`),
  ].join("\n");

  let enqueued = 0;
  const failures: string[] = [];
  for (const lead of leads) {
    if (await alreadySent(admin, "safeguarding", `sg1:${day}:${lead.person_id}`, "sg1_nightly_check")) continue;
    const result = await enqueue(admin, {
      channel: "email",
      category: "transactional",
      personId: lead.person_id,
      subject: `[Safeguarding] SG-1 check — ${rows.length} conversation(s) to review`,
      body,
      template: "sg1_nightly_check",
      entity: "safeguarding",
      entityId: `sg1:${day}:${lead.person_id}`,
    });
    if (result.ok) enqueued++;
    else failures.push(`lead ${lead.person_id}: ${result.error}`);
  }
  return { rows: rows.length, enqueued, failures };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();

  const leads = await safeguardingLeads(admin);

  const certifications = await runCertificationNudges(admin, leads);
  const compliance = await runComplianceReport(admin, leads);
  const sg1 = await runSg1Check(admin, leads);

  return json({ leads: leads.length, certifications, compliance, sg1 });
});
