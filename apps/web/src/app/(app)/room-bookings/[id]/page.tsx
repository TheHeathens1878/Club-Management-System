import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isStaff, isCommittee, isSuperUser } from "@/lib/auth";
import { DeleteBookingButton } from "../delete-booking-button";
import { EditBookingForm } from "../edit-booking-form";
import { createAdminClient } from "@/lib/supabase/admin";
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

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

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
  if (!isStaff(session.profile?.role)) redirect("/room-bookings");

  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: booking }, { data: rooms }, { data: paymentRows }] = await Promise.all([
    admin.from("room_bookings").select("*").eq("id", id).maybeSingle(),
    admin.from("function_rooms").select("id,name").order("sort_order"),
    admin.from("booking_payments").select("*").eq("booking_id", id).order("paid_at", { ascending: false }),
  ]);

  if (!booking) notFound();

  const payments = (paymentRows ?? []).map((p) => ({
    id: p.id as string,
    amount_pence: Number(p.amount_pence),
    paid_at: String(p.paid_at),
    method: (p.method as string | null) ?? null,
    reference: (p.reference as string | null) ?? null,
    source: String(p.source ?? "manual"),
    authorised_by_name: (p.authorised_by_name as string | null) ?? null,
    note: (p.note as string | null) ?? null,
  }));
  const totalPence = Number((booking as Record<string, unknown>).total_pence ?? booking.amount_pence ?? 0);
  const depositPence = Number((booking as Record<string, unknown>).deposit_pence ?? 0);
  const settings = await getSettings();
  const defaultDepositPence = Number(settings.deposit_default_pence) || 0;

  const roomName = (rooms ?? []).find((r) => r.id === booking.room_id)?.name ?? "Unknown room";
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
        subtitle={`${roomName} · ${formatDate(String(booking.date))}`}
        action={
          <Link href="/room-bookings" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="h-4 w-4" /> All bookings
          </Link>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Booking details */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Booking details</CardTitle>
              <div className="flex gap-2">
                <Badge variant={statusVariant(String(booking.status))} className="capitalize">
                  {booking.status}
                </Badge>
                {booking.payment_status === "paid" && (
                  <Badge variant="success">Paid</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <Detail label="Room" value={roomName} />
              <Detail label="Date" value={formatDate(String(booking.date))} />
              <Detail label="Time" value={`${String(booking.start_time).slice(0,5)} – ${String(booking.end_time).slice(0,5)}`} />
              {booking.occasion && <Detail label="Occasion" value={String(booking.occasion)} />}
              {booking.estimated_guests && <Detail label="Estimated guests" value={String(booking.estimated_guests)} />}
              {booking.amount_pence && <Detail label="Quoted price" value={formatCurrency(Number(booking.amount_pence))} />}
            </CardContent>
          </Card>

          {/* Booker details */}
          <Card>
            <CardHeader><CardTitle>Booker</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {(booking as Record<string, unknown>).booker_first_name
                ? <>
                    <Detail label="First name" value={String((booking as Record<string, unknown>).booker_first_name)} />
                    <Detail label="Last name" value={String((booking as Record<string, unknown>).booker_last_name ?? "—")} />
                  </>
                : <Detail label="Name" value={String(booking.booker_name)} />
              }
              <Detail label="Email" value={String(booking.booker_email)} />
              <Detail label="Mobile" value={booking.booker_phone ? String(booking.booker_phone) : "—"} />
            </CardContent>
          </Card>

          {/* Edit booking */}
          {canEditBooking && (
            <Card>
              <CardHeader><CardTitle>Edit booking</CardTitle></CardHeader>
              <CardContent>
                <EditBookingForm
                  bookingId={id}
                  rooms={(rooms ?? []).map((r) => ({ id: r.id, name: String(r.name) }))}
                  initial={{
                    room_id: String(booking.room_id),
                    date: String(booking.date),
                    start_time: String(booking.start_time).slice(0, 5),
                    end_time: String(booking.end_time).slice(0, 5),
                    booker_first_name: String((booking as Record<string, unknown>).booker_first_name ?? booking.booker_name?.toString().split(" ")[0] ?? ""),
                    booker_last_name: String((booking as Record<string, unknown>).booker_last_name ?? booking.booker_name?.toString().split(" ").slice(1).join(" ") ?? ""),
                    booker_email: String(booking.booker_email ?? ""),
                    booker_phone: String(booking.booker_phone ?? ""),
                    occasion: String(booking.occasion ?? ""),
                    estimated_guests: booking.estimated_guests ? String(booking.estimated_guests) : "",
                    notes: String(booking.notes ?? ""),
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
                <p className="text-sm whitespace-pre-wrap">{String(booking.notes)}</p>
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
                  defaultValue={String(booking.internal_notes ?? "")}
                  placeholder="Add notes visible only to staff…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                />
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Save notes
                </button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Status / actions */}
          {canEdit && (
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
              <CardContent>
                <StatusForm
                  bookingId={id}
                  currentStatus={String(booking.status)}
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
                {String(booking.payment_status).replace("_", " ")}
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

          {/* Meta */}
          <Card>
            <CardHeader><CardTitle>Request info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received</span>
                <span>{new Date(String(booking.created_at)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
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
