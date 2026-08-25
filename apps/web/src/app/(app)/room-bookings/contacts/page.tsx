import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { getSessionProfile, isStaff } from "@/lib/auth";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { createClient } from "@/lib/supabase/server";

/**
 * /room-bookings/contacts — the function room's own contacts book (Adam,
 * 2026-08-25: hire contacts kept OUT of the members database).
 *
 * Read as the caller: `booking_contacts` is staff/club_admin under RLS, and
 * so are the bookings behind the hire counts. Contacts are written by the
 * hire form and the staff booking flows; there is nothing to create here —
 * a contact exists because a booking did.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Hire contacts" };

const PAGE_LIMIT = 200;

export default async function BookingContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isStaff(session.profile?.role)) redirect("/room-bookings");

  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const supabase = await createClient();
  let query = supabase
    .from("booking_contacts")
    .select("id,name,email,phone,notes")
    .order("name")
    .limit(PAGE_LIMIT);
  if (term.length > 0) {
    const like = `%${term.replaceAll("%", "").replaceAll(",", "")}%`;
    query = query.or(`name.ilike.${like},email.ilike.${like}`);
  }
  const { data: contacts, error } = await query;

  const ids = (contacts ?? []).map((contact) => contact.id);
  const { data: hireRows } = ids.length
    ? await supabase
        .from("bookings")
        .select("contact_id,starts_at,status")
        .in("contact_id", ids)
        .neq("status", "cancelled")
    : { data: [] };
  const hires = new Map<string, { count: number; last: string }>();
  for (const row of hireRows ?? []) {
    if (!row.contact_id) continue;
    const entry = hires.get(row.contact_id) ?? { count: 0, last: "" };
    entry.count += 1;
    if (row.starts_at > entry.last) entry.last = row.starts_at;
    hires.set(row.contact_id, entry);
  }

  return (
    <>
      <PageHeader
        title="Hire contacts"
        subtitle="The function room's own contacts book — separate from the members database"
        action={
          <Link
            href="/room-bookings/new"
            className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"}
          >
            <CalendarPlus className="h-4 w-4" /> New booking
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        <form method="get" className="max-w-sm">
          <Label htmlFor="contact-search" className="sr-only">
            Search contacts
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="contact-search"
              name="q"
              defaultValue={term}
              placeholder="Search by name or email"
              className="min-h-[44px] pl-9 lg:min-h-0"
            />
          </div>
        </form>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load the contacts book: {error.message}
          </p>
        ) : (contacts ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {term
                ? "No contact matches that search."
                : "No hire contacts yet — one appears the first time a booking carries an email address."}
            </CardContent>
          </Card>
        ) : (
          <>
          {/* Phone: one card per contact — name and email as the title block,
              the hire history as the right-hand pill. */}
          <div className="space-y-2 lg:hidden">
            {(contacts ?? []).map((contact) => {
              const hire = hires.get(contact.id) ?? null;
              return (
                <div key={contact.id} className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-medium">{contact.name}</p>
                    <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {hire?.count ?? 0} {hire?.count === 1 ? "hire" : "hires"}
                    </span>
                  </div>
                  {contact.email && (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{contact.email}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {contact.phone ?? "No phone"}
                    {hire?.last
                      ? ` · last hire ${formatBookingDateShort(instantToLocal(hire.last).date)}`
                      : ""}
                  </p>
                  {contact.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">{contact.notes}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-sm lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">Hires</th>
                  <th className="px-4 py-2.5 font-medium">Last hire</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(contacts ?? []).map((contact) => {
                  const hire = hires.get(contact.id) ?? null;
                  return (
                    <tr key={contact.id} className="transition-colors hover:bg-secondary/40">
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium">{contact.name}</p>
                        {contact.email && (
                          <p className="text-xs text-muted-foreground">{contact.email}</p>
                        )}
                        {contact.notes && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{contact.notes}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {contact.phone ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">{hire?.count ?? 0}</td>
                      <td className="px-4 py-3 align-top">
                        {hire?.last ? (
                          formatBookingDateShort(instantToLocal(hire.last).date)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Hirers live here, not in People — a hire contact is not a member record. Contacts are
          added and refreshed automatically by the hire form and staff bookings, one per email
          address.
        </p>
      </div>
    </>
  );
}
