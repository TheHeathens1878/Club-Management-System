import { NextResponse } from "next/server";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

/**
 * The contacts database as a CSV (spec §2.7's "Export CSV").
 *
 * Committee/admin only — the same gate as the page. Deliberately WITHOUT
 * dates of birth: a spreadsheet that leaves the building must not carry
 * children's DOBs; the age question is answered by the under-18 flag alone.
 * Under-18 contact goes through the guardian, exactly as the page shows it.
 */

export const dynamic = "force-dynamic";

function csvField(value: string | null | undefined): string {
  const text = value ?? "";
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(): Promise<NextResponse> {
  const session = await getSessionProfile();
  if (!session) return new NextResponse("Sign in first.", { status: 401 });
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) {
    return new NextResponse("The contacts export is for the committee.", { status: 403 });
  }

  const supabase = await createClient();
  const { data: people, error } = await supabase
    .from("people")
    .select("id,first_name,last_name,dob,email,phone")
    .is("deleted_at", null)
    .order("last_name")
    .order("first_name")
    .limit(5000);
  if (error) return new NextResponse(`Could not export: ${error.message}`, { status: 500 });

  const rows = people ?? [];
  const minorCutoff = new Date();
  minorCutoff.setFullYear(minorCutoff.getFullYear() - 18);

  // Guardians for every under-18, so their row carries the right contact.
  const minorIds = rows
    .filter((p) => !p.dob || new Date(p.dob) > minorCutoff)
    .map((p) => p.id);
  const guardianOf = new Map<string, string>();
  const guardianPeople = new Map<string, { name: string; phone: string | null; email: string | null }>();
  if (minorIds.length > 0) {
    const { data: links } = await supabase
      .from("guardianships")
      .select("child_person_id,guardian_person_id")
      .in("child_person_id", minorIds)
      .is("ended_at", null);
    const guardianIds = Array.from(new Set((links ?? []).map((l) => l.guardian_person_id)));
    if (guardianIds.length > 0) {
      const { data: guardians } = await supabase
        .from("people")
        .select("id,first_name,last_name,phone,email")
        .in("id", guardianIds);
      for (const g of guardians ?? []) {
        guardianPeople.set(g.id, {
          name: `${g.first_name} ${g.last_name}`.trim(),
          phone: g.phone,
          email: g.email,
        });
      }
    }
    for (const link of links ?? []) {
      if (!guardianOf.has(link.child_person_id)) {
        guardianOf.set(link.child_person_id, link.guardian_person_id);
      }
    }
  }

  const header = "Last name,First name,Under 18,Email,Phone,Contact via";
  const lines = rows.map((p) => {
    const minor = !p.dob || new Date(p.dob) > minorCutoff;
    const guardian = minor ? guardianPeople.get(guardianOf.get(p.id) ?? "") : undefined;
    return [
      csvField(p.last_name),
      csvField(p.first_name),
      minor ? "yes" : "no",
      csvField(minor ? guardian?.email ?? "" : p.email),
      csvField(minor ? guardian?.phone ?? "" : p.phone),
      csvField(guardian?.name ?? ""),
    ].join(",");
  });

  return new NextResponse([header, ...lines].join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aom-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
