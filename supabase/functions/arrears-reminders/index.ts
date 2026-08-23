// arrears-reminders — P4.2. The escalating "you still owe subs" email.
//
// AUTH. Scheduled: pg_cron → pg_net → here with the service-role key, which is
// the only credential accepted.
//
// WHAT IT SENDS. `subscription_arrears` rows with money outstanding, on a live
// subscription (`active` / `past_due` — a `pending` subscription has not been
// checked out yet and is P4.1's problem, not a debt). Three tiers by age:
//
//   ≥ tier1_days (14)  gentle   template arrears_tier1
//   ≥ tier2_days (30)  firm     template arrears_tier2
//   ≥ tier3_days (60)  final    template arrears_tier3
//
// each overridable with the `arrears.tierN_days` site settings. Only the
// highest tier reached is sent on any given run.
//
// IDEMPOTENCY. One send per (subscription, tier), ever. The record is
// `outbound_messages` itself — entity `subscriptions`, entity_id the
// subscription id, template `arrears_tierN` — so a re-run, a crash halfway
// through, or two overlapping invocations cannot double-chase a member. Rows
// that never went out (`dry_run`, `suppressed`, `skipped_preference`) do not
// count as a send, so switching dry-run off does not lose the first reminder.
//
// DRY RUN. Handled entirely by `enqueue_message` via the `comms.dry_run` site
// setting: this function does not need to know.

import { adminClient, type Client, json, requireServiceRole, settingInt } from "../_shared/auth.ts";
import { enqueue, pounds } from "../_shared/comms.ts";

type ArrearsRow = {
  subscription_id: string;
  person_id: string;
  payer_person_id: string;
  plan_name: string;
  team_name: string | null;
  status: string;
  amount_due_pence: number;
  paid_pence: number;
  outstanding_pence: number;
  days_since_start: number;
};

type Tier = 1 | 2 | 3;

const TONE: Record<Tier, string> = {
  1: "gentle",
  2: "firm",
  3: "final",
};

function tierFor(days: number, thresholds: Record<Tier, number>): Tier | null {
  if (days >= thresholds[3]) return 3;
  if (days >= thresholds[2]) return 2;
  if (days >= thresholds[1]) return 1;
  return null;
}

function subjectFor(tier: Tier, row: ArrearsRow): string {
  const what = row.team_name ? `${row.team_name} — ${row.plan_name}` : row.plan_name;
  switch (tier) {
    case 1:
      return `Subs reminder: ${what}`;
    case 2:
      return `Subs still outstanding: ${what}`;
    case 3:
      return `Final reminder — subs outstanding: ${what}`;
  }
}

function bodyFor(tier: Tier, row: ArrearsRow): string {
  const what = row.team_name ? `${row.team_name} — ${row.plan_name}` : row.plan_name;
  const owed = pounds(row.outstanding_pence);
  const paid = pounds(row.paid_pence);
  const due = pounds(row.amount_due_pence);
  const ledger = `Amount due: ${due}\nPaid so far: ${paid}\nOutstanding: ${owed}`;

  switch (tier) {
    case 1:
      return [
        `Hello,`,
        ``,
        `A quick reminder that subs for ${what} are outstanding.`,
        ``,
        ledger,
        ``,
        `You can pay from your account on the club website. If you have already paid, or if the amount looks wrong, please reply and we will sort it out.`,
        ``,
        `Thank you,`,
        `AoM Sports Club`,
      ].join("\n");
    case 2:
      return [
        `Hello,`,
        ``,
        `Subs for ${what} are now ${row.days_since_start} days overdue.`,
        ``,
        ledger,
        ``,
        `Please pay from your account on the club website, or reply to arrange a payment plan — we would much rather agree instalments than chase.`,
        ``,
        `Thank you,`,
        `AoM Sports Club`,
      ].join("\n");
    case 3:
      return [
        `Hello,`,
        ``,
        `This is a final reminder that subs for ${what} remain unpaid after ${row.days_since_start} days.`,
        ``,
        ledger,
        ``,
        `Please pay, or contact the club, within the next seven days so we can keep the place. If paying is difficult, tell us — the club would rather help than lose a player.`,
        ``,
        `Thank you,`,
        `AoM Sports Club`,
      ].join("\n");
  }
}

async function alreadyChased(admin: Client, subscriptionIds: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  if (subscriptionIds.length === 0) return seen;

  // One query for the whole batch rather than one per subscription.
  const { data, error } = await admin
    .from("outbound_messages")
    .select("entity_id, template")
    .eq("entity", "subscriptions")
    .in("template", ["arrears_tier1", "arrears_tier2", "arrears_tier3"])
    .in("status", ["queued", "sent"])
    .in("entity_id", subscriptionIds);
  if (error) return seen;
  for (const row of (data ?? []) as { entity_id: string; template: string }[]) {
    seen.add(`${row.entity_id}|${row.template}`);
  }
  return seen;
}

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) return json({ error: "unauthorised" }, 401);
  const admin = adminClient();

  const thresholds: Record<Tier, number> = {
    1: await settingInt(admin, "arrears.tier1_days", 14, { min: 1 }),
    2: await settingInt(admin, "arrears.tier2_days", 30, { min: 1 }),
    3: await settingInt(admin, "arrears.tier3_days", 60, { min: 1 }),
  };

  // `person_name` is deliberately not selected: it is `display_name()`, which
  // returns NULL for the service role anyway, and the reminder addresses the
  // payer, not the player.
  const { data, error } = await admin
    .from("subscription_arrears")
    .select(
      "subscription_id, person_id, payer_person_id, plan_name, team_name, status, amount_due_pence, paid_pence, outstanding_pence, days_since_start",
    )
    .gt("outstanding_pence", 0)
    .in("status", ["active", "past_due"]);
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as ArrearsRow[];
  const due: { row: ArrearsRow; tier: Tier }[] = [];
  for (const row of rows) {
    const tier = tierFor(row.days_since_start, thresholds);
    if (tier !== null) due.push({ row, tier });
  }

  const chased = await alreadyChased(admin, due.map((d) => d.row.subscription_id));

  const counts = { tier1: 0, tier2: 0, tier3: 0 };
  const outcomes: Record<string, number> = {};
  let skippedAlreadySent = 0;
  const failures: { subscription_id: string; error: string }[] = [];

  for (const { row, tier } of due) {
    const template = `arrears_tier${tier}`;
    if (chased.has(`${row.subscription_id}|${template}`)) {
      skippedAlreadySent++;
      continue;
    }

    const result = await enqueue(admin, {
      channel: "email",
      category: "reminder",
      personId: row.payer_person_id,
      subject: subjectFor(tier, row),
      body: bodyFor(tier, row),
      template,
      entity: "subscriptions",
      entityId: row.subscription_id,
    });

    if (!result.ok) {
      failures.push({ subscription_id: row.subscription_id, error: result.error });
      continue;
    }
    counts[`tier${tier}` as keyof typeof counts]++;
    outcomes[result.result.status] = (outcomes[result.result.status] ?? 0) + 1;
  }

  return json({
    scanned: rows.length,
    thresholds: { tier1_days: thresholds[1], tier2_days: thresholds[2], tier3_days: thresholds[3] },
    tone: TONE,
    due: due.length,
    enqueued: counts.tier1 + counts.tier2 + counts.tier3,
    by_tier: counts,
    by_status: outcomes,
    skipped_already_sent: skippedAlreadySent,
    failures,
  });
});
