import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/finance";
import { createClient } from "@/lib/supabase/server";

import { MembersClient, type AccountRow, type PreviewRow, type PersonOption } from "./members-client";

export const metadata = { title: "Members & numbers" };

/**
 * Membership numbers and the households under them.
 *
 * The list is the two-way click-through Adam asked for: click a name and the
 * membership expands to everyone under that number; search ANY member —
 * child, linked adult — and the row that comes back is the lead member's
 * (reverse member search).
 */
export default async function FinanceMembersPage() {
  await requireFinance();
  const supabase = await createClient();

  const [{ data: summary }, { data: accountPeople }, { data: preview }, { data: people }] = await Promise.all([
    supabase.from("finance_account_summary").select("*").order("member_no"),
    supabase
      .from("billing_account_people")
      .select("account_id,person_id,letter,removed_at,people(first_name,last_name,dob)")
      .order("letter"),
    supabase.rpc("preview_membership_numbering"),
    supabase
      .from("people")
      .select("id,first_name,last_name,dob")
      .is("deleted_at", null)
      .order("last_name")
      .order("first_name"),
  ]);

  const peopleByAccount = new Map<string, AccountRow["people"]>();
  const numberedPeople = new Set<string>();
  for (const row of accountPeople ?? []) {
    const list = peopleByAccount.get(row.account_id) ?? [];
    list.push({
      person_id: row.person_id,
      letter: row.letter,
      removed: row.removed_at !== null,
      name: row.people ? `${row.people.first_name} ${row.people.last_name}` : "(unknown)",
    });
    peopleByAccount.set(row.account_id, list);
    if (row.removed_at === null) numberedPeople.add(row.person_id);
  }

  const accounts: AccountRow[] = (summary ?? [])
    .filter((row) => row.account_id !== null && row.member_no !== null)
    .map((row) => ({
      account_id: row.account_id as string,
      member_no: row.member_no as number,
      lead_person_id: row.lead_person_id as string,
      lead_name: row.lead_name ?? "(unknown)",
      status: row.status ?? "active",
      balance_pence: row.balance_pence ?? 0,
      overdue_pence: row.overdue_pence ?? 0,
      people: peopleByAccount.get(row.account_id as string) ?? [],
    }));

  const previewRows: PreviewRow[] = (preview ?? []).map((row) => ({
    lead_person_id: row.lead_person_id as string,
    lead_name: row.lead_name ?? "(unknown)",
    basis: row.basis ?? "—",
    household: Array.isArray(row.household)
      ? (row.household as { person_id: string; name: string }[])
      : [],
  }));

  const unnumbered: PersonOption[] = (people ?? [])
    .filter((person) => !numberedPeople.has(person.id))
    .map((person) => ({ id: person.id, name: `${person.first_name} ${person.last_name}` }));

  return (
    <>
      <PageHeader title="Members & numbers" subtitle="Every membership number, and the household under it" />
      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Memberships</CardTitle>
            <p className="text-sm text-muted-foreground">
              Search any member — searching a child or partner finds the lead member they sit under.
              Click a row to see everyone sharing the number.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <MembersClient accounts={accounts} preview={previewRows} unnumbered={unnumbered} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
