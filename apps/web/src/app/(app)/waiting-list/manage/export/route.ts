import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@club/db";

import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES, isWaitingListStatus } from "@/lib/waiting-list";

/**
 * CSV export of the waiting list desk (gap 10).
 *
 * The user-scoped client is the whole access control story: `wl_entries_admin`
 * returns everything to a club administrator, `wl_entries_coach_read` returns
 * only the age groups the caller was granted, and anyone else gets an empty
 * file. Nothing here re-checks a role — a check that disagreed with the policy
 * would be the bug.
 *
 * The query string mirrors the desk's filters so "export what I am looking at"
 * means exactly that.
 */

type Entry = Database["public"]["Tables"]["waiting_list_entries"]["Row"];

/** What makes Excel on Windows read the download as UTF-8 rather than ANSI. */
const UTF8_BOM = String.fromCharCode(0xfeff);

const COLUMNS: readonly (keyof Entry)[] = [
  "player_name",
  "dob",
  "age_group",
  "school_year",
  "biological_sex",
  "team_preference",
  "school",
  "health_conditions",
  "parent_name",
  "parent_email",
  "parent_phone",
  "coaching_interest",
  "coaching_note",
  "status",
  "priority",
  "source",
  "created_at",
];

const HEADERS: Record<string, string> = {
  player_name: "Player",
  dob: "Date of birth",
  age_group: "Age group",
  school_year: "School year",
  biological_sex: "Biological sex",
  team_preference: "Team preference",
  school: "School",
  health_conditions: "Health conditions",
  parent_name: "Parent or guardian",
  parent_email: "Email",
  parent_phone: "Phone",
  coaching_interest: "Willing to coach",
  coaching_note: "Coaching note",
  status: "Status",
  priority: "Priority",
  source: "Source",
  created_at: "Applied",
};

/**
 * One CSV cell.
 *
 * A leading `=`, `+`, `-`, `@`, tab or carriage return makes a spreadsheet
 * treat the value as a formula, and these cells hold text a member of the
 * public typed into a form. Prefixing with an apostrophe keeps it text.
 */
function cell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const search = request.nextUrl.searchParams;
  const status = search.get("status");
  const ageGroup = search.get("age_group")?.trim() || undefined;
  const coachingOnly = search.get("coaching") === "1";
  const showAll = search.get("show_all") === "1";

  let query = supabase.from("waiting_list_entries").select("*");
  if (status && isWaitingListStatus(status)) {
    query = query.eq("status", status);
  } else if (!showAll) {
    query = query.in("status", [...ACTIVE_STATUSES]);
  }
  if (ageGroup) query = query.eq("age_group", ageGroup);
  if (coachingOnly) query = query.eq("coaching_interest", true);

  const { data, error } = await query
    .order("age_group")
    .order("priority", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = data ?? [];
  const lines = [COLUMNS.map((column) => cell(HEADERS[column] ?? column)).join(",")];
  for (const row of rows) {
    lines.push(
      COLUMNS.map((column) => {
        const value = row[column];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return cell(value);
        }
        return cell(null);
      }).join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`${UTF8_BOM}${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="waiting-list-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
