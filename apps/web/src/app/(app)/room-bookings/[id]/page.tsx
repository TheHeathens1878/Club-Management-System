import { notFound, redirect } from "next/navigation";
import { extrasSummary } from "@/lib/booking-extras";
import { SecurityDepositCard } from "../security-deposit-card";
import Link from "next/link";
import { getSessionProfile, isStaff, isCommittee, isSuperUser } from "@/lib/auth";
import { DeleteBookingButton } from "../delete-booking-button";
import { EditBookingForm } from "../edit-booking-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { splitContactName } from "@/lib/person-name";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { StatusForm } from "../status-form";
import { PaymentsPanel } from "../payments-panel";
import { addInternalNote } from "../actions";
import { formatBookingDate, instantsToLocalWindow } from "@/lib/booking-time";
import { FUNCTION_ROOM } from "@/lib/booking-types";

function statusVariant(s: string): "success" | "muted" | "destructive" | "default" {
  if (s === "confirmed") return "success";
  if (s === "cancelled") return "destructive";
  return "default";
}

export default async function RoomBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isStaff(session.profile?.role)) redirect("/lobby");

  const { id } = await params;
  const admin = createAdminClient();

  const [
    { data: booking },
    { data: rooms },
    { data: paymentRows },
    { data: legacyComms },
    { data: outbound },
  ] = await Promise.all([
    admin.from("bookings").select("*").eq("id", id).maybeSingle(),
    admin.from("resources").select("id,name").eq("type", FUNCTION_ROOM).order("sort_order"),
    admin.from("payments").select("*").eq("booking_id", id).order("paid_at", { ascending: false }),
    // Every email about this booking, old app and new: the migrated
    // booking_comms history plus outbound_messages rows stamped with this
    // entity (reminders, quotes, confirmations, thank-yous).
    admin
      .from("booking_comms")
      .select("id,kind,to_address,subject,sent_at,sent_by_name")
      .eq("booking_id", id)
      .order("sent_at", { ascending: false }),
    admin
      .from("outbound_messages")
      .select("id,to_address,subject,template,status,sent_at,created_at")
      .eq("entity", "bookings")
      .eq("entity_id", id)
      .eq("channel", "email")
      .order("created_at", { ascending: false }),
  ]);

  const emailLog = [
    ...(outbound ?? []).map((m) => ({
      id: `o-${m.id}`,
      at: m.sent_at ?? m.created_at,
      to: m.to_address ?? "—",
      subject: m.subject ?? m.template ?? "Email",
      via: m.status === "sent" ? "sent" : m.status,
    })),
    ...(legacyComms ?? []).map((m) => ({
      id: `l-${m.id}`,
      at: m.sent_at,
      to: m.to_address ?? "—",
      subject: m.subject ?? m.kind,
      via: m.sent_by_name ? `by ${m.sent_by_name}` : "sent",
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  if (!booking) notFound();

  // The period is timestamptz; this page has always shown London wall clock.
  const window = instantsToLocalWindow(booking.starts_at, booking.ends_at);

  const payments = (paymentRows ?? []).map((p) => ({
    id: p.id,
    amount_pence: p.amount_pence,
    paid_at: p.paid_at,
    method: p.method,
    reference: p.reference,
    source: p.source,
    authorised_by_name: p.authorised_by_name,
    note: p.note,
  }));
  const totalPence = booking.total_pence ?? 0;
  const depositPence = booking.deposit_pence ?? 0;
  const settings = await getSettings();
  const defaultDepositPence = Number(settings.deposit_default_pence) || 0;

  const roomName = (rooms ?? []).find((r) => r.id === booking.resource_id)?.name ?? "Unknown room";
  const canEdit = isStaff(session.profile?.role);
  const canDelete = isCommittee(session.profile?.role);
  const canEditBooking = isSuperUser(session.profile?.role);
  const shortRef = id.slice(0, 8).toUpperCase();

  async function saveNote(formData: FormData) {
    "use server";
    await addInternalNote(id, String(formData.get("internal_notes") || "").trim());
  }

  return (
    <>
      <PageHeader
        title={`Booking #${shortRef}`}
        subtitle={`${roomName} · ${formatBookingDate(window.date)}`}
        action={
          <Link
            href="/room-bookings"
            className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"}
          >
            <ChevronLeft className="h-4 w-4" /> All bookings
          </Link>
        }
      />

      <div className="grid gap-4 p-4 lg:grid-cols-3 lg:gap-6 lg:p-6">
        <div className="space-y-4 lg:col-span-2 lg:space-y-6">
          {/* Booking details */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Booking details</CardTitle>
              <div className="flex gap-2">
                <Badge variant={statusVariant(booking.status)} className="capitalize">
                  {booking.status}
                </Badge>
                {booking.payment_status === "paid" && (
                  <Badge variant="success">Paid</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <Detail label="Room" value={roomName} />
              <Detail label="Date" value={formatBookingDate(window.date)} />
              <Detail label="Time" value={`${window.startTime} – ${window.endTime}`} />
              {booking.occasion && <Detail label="Occasion" value={booking.occasion} />}
              {booking.estimated_guests !== null && <Detail label="Estimated guests" value={String(booking.estimated_guests)} />}
              {(booking.member_discount_pence ?? 0) > 0 && (
                <Detail label="Member discount" value={`−${formatCurrency(booking.member_discount_pence ?? 0)}`} />
              )}
              {booking.is_member && (
                <Detail
                  label="Club member"
                  value={[booking.membership_type, booking.member_number].filter(Boolean).join(" · ") || "Yes"}
                />
              )}
              {extrasSummary(booking.selected_extras) && (
                <Detail label="Extras" value={extrasSummary(booking.selected_extras)} />
              )}
              {booking.security_deposit_pence !== null && booking.security_deposit_pence > 0 && (
                <Detail
                  label="Security deposit"
                  value={`${formatCurrency(booking.security_deposit_pence)} (refundable — 18th birthday)`}
                />
              )}
              {booking.total_pence !== null && <Detail label="Quoted price" value={formatCurrency(booking.total_pence)} />}
            </CardContent>
          </Card>

          {/* Booker details */}
          <Card>
            <CardHeader><CardTitle>Booker</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {booking.booker_first_name
                ? <>
                    <Detail label="First name" value={booking.booker_first_name} />
                    <Detail label="Last name" value={booking.booker_last_name ?? "—"} />
                  </>
                : <Detail label="Name" value={booking.booker_name} />
              }
              <Detail label="Email" value={booking.booker_email} />
              <Detail label="Mobile" value={booking.booker_phone ?? "—"} />
            </CardContent>
          </Card>

          {/* Edit booking */}
          {canEditBooking && (
            <Card>
              <CardHeader><CardTitle>Edit booking</CardTitle></CardHeader>
              <CardContent>
                <EditBookingForm
                  bookingId={id}
                  rooms={rooms ?? []}
                  initial={{
                    resource_id: booking.resource_id,
                    date: window.date,
                    start_time: window.startTime,
                    end_time: window.endTime,
                    booker_first_name: booking.booker_first_name ?? splitContactName(booking.booker_name).firstName,
                    booker_last_name: booking.booker_last_name ?? splitContactName(booking.booker_name).lastName,
                    booker_email: booking.booker_email,
                    booker_phone: booking.booker_phone ?? "",
                    occasion: booking.occasion ?? "",
                    estimated_guests: booking.estimated_guests === null ? "" : String(booking.estimated_guests),
                    notes: booking.notes ?? "",
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Notes from booker (read-only when not editing) */}
          {!canEditBooking && booking.notes && (
            <Card>
              <CardHeader><CardTitle>Notes from booker</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{booking.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Internal notes */}
          <Card>
            <CardHeader><CardTitle>Internal notes <span className="text-sm font-normal text-muted-foreground">(staff only)</span></CardTitle></CardHeader>
            <CardContent>
              <form action={saveNote} className="space-y-3">
                <textarea
                  name="internal_notes"
                  rows={4}
                  defaultValue={booking.internal_notes ?? ""}
                  placeholder="Add notes visible only to staff…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
                <button
                  type="submit"
                  className="min-h-[44px] w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 lg:min-h-0 lg:w-auto"
                >
                  Save notes
                </button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:space-y-6">
          {/* Status / actions */}
          {canEdit && (
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
              <CardContent>
                <StatusForm
                  bookingId={id}
                  currentStatus={booking.status}
                  isStaff={canEdit}
                  defaultDepositPence={defaultDepositPence}
                  currentTotalPence={totalPence || null}
                  currentDepositPence={depositPence || null}
                />
              </CardContent>
            </Card>
          )}

          {/* Payments */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Payments</CardTitle>
              <Badge variant={booking.payment_status === "paid" ? "success" : "muted"} className="capitalize">
                {booking.payment_status.replace("_", " ")}
              </Badge>
            </CardHeader>
            <CardContent>
              <PaymentsPanel
                bookingId={id}
                payments={payments}
                totalPence={totalPence}
                depositPence={depositPence}
                canDelete={canDelete}
              />
            </CardContent>
          </Card>

          {(booking.security_deposit_pence ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle>Security deposit</CardTitle></CardHeader>
              <CardContent>
                <SecurityDepositCard
                  bookingId={id}
                  amountPence={booking.security_deposit_pence ?? 0}
                  returnedAt={booking.security_deposit_returned_at}
                  returnedMethod={booking.security_deposit_returned_method}
                  returnedNote={booking.security_deposit_returned_note}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Emails sent</CardTitle></CardHeader>
            <CardContent>
              {emailLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing sent about this booking yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {emailLog.slice(0, 12).map((m) => (
                    <li key={m.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                      <p className="font-medium leading-snug">{m.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.at
                          ? new Date(m.at).toLocaleString("en-GB", {
                              day: "numeric", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}{" "}
                        · {m.to} · {m.via}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Meta */}
          <Card>
            <CardHeader><CardTitle>Request info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received</span>
                <span>{new Date(booking.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs">#{shortRef}</span>
              </div>
            </CardContent>
          </Card>

          {canDelete && (
            <Card className="border-destructive/30">
              <CardHeader><CardTitle className="text-destructive text-sm">Danger zone</CardTitle></CardHeader>
              <CardContent>
                <DeleteBookingButton id={id} label="Delete this booking" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}
