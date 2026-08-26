// safeguarding-nudges — the nightly safeguarding sweep.
//
// AUTH. Scheduled only: the service-role key. `sg1_nightly_check` is granted
// to `service_role` alone, so nothing else could run this anyway.
//
// ONE JOB
//   `sg1_nightly_check()` — open conversations that violate SG-1. One email
//   per lead per day, **conversation ids only**.
//
// It used to run two more: the SG-6 certification expiry nudges at 90/30/7 and
// the daily compliance report. Both were retired on 2026-08-26 with the rest
// of the in-app SG-6 tier — DBS checks, safeguarding and coaching
// qualifications live on the FA Clubs Portal, and nudging about records the
// club no longer maintains here was noise. `due_certification_nudges()`,
// `mark_certification_nudged()` and `compliance_report()` still exist in the
// database (see SAFEGUARDING.md SG-6); nothing calls them.
//
// SG-7. Nothing here carries narrative, a concern, or a message body: the
// SG-1 mail is a list of ids and nothing else.

import { adminClient, type Client, json, requireServiceRole } from "../_shared/auth.ts";
import { alreadySent, enqueue, safeguardingLeads } from "../_shared/comms.ts";

type Sg1Row = { conversation_id: string; type: string };

type Lead = { person_id: string; email: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SG-1 nightly check
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

  const sg1 = await runSg1Check(admin, leads);

  return json({ leads: leads.length, sg1 });
});
