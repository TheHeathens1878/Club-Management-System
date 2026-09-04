import { redirect } from "next/navigation";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { updateRoom, createRoom, updateRoomMemberDiscount } from "../actions";
import { DeleteRoomButton } from "./delete-room-button";
import { ExtrasEditor } from "./extras-editor";
import { parseExtrasConfig } from "@/lib/booking-extras";
import { getSettings } from "@/lib/settings";
import { FUNCTION_ROOM } from "@/lib/booking-types";

export const metadata = { title: "Manage Rooms" };

export default async function RoomsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/lobby");

  const { saved, error: errorParam } = await searchParams;

  const admin = createAdminClient();
  const settings = await getSettings();
  const memberDiscountPounds = (Number(settings.room_member_discount_pence) || 0) / 100;
  const { data: rooms, error } = await admin
    .from("resources")
    .select("*")
    .eq("type", FUNCTION_ROOM)
    .order("sort_order");

  function penceToPounds(pence: number | null | undefined) {
    if (!pence) return "";
    return (pence / 100).toFixed(2);
  }

  return (
    <>
      <PageHeader
        title="Manage Rooms"
        subtitle="Update room details, capacity and pricing"
      />
      <div className="max-w-3xl space-y-4 p-4 lg:space-y-6 lg:p-6">
        {saved === "discount" && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Member discount saved.
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Member discount</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateRoomMemberDiscount} className="flex flex-wrap items-end gap-3">
              <div className="w-36 space-y-1.5">
                <Label htmlFor="member-discount">Amount (£)</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                  <Input
                    id="member-discount"
                    name="member_discount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={memberDiscountPounds ? memberDiscountPounds.toFixed(2) : ""}
                    placeholder="e.g. 25.00"
                    className="pl-7"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="min-h-[44px] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 lg:min-h-0"
              >
                Save
              </button>
              <p className="basis-full text-xs text-muted-foreground">
                Taken off room hire for players, club families and social members once their claim
                is checked. The booking form quotes it; Confirm on a booking prefills it.
              </p>
            </form>
          </CardContent>
        </Card>

        {saved === "new" && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Room created successfully.
          </div>
        )}
        {saved && saved !== "new" && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Room saved successfully.
          </div>
        )}

        {errorParam && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorParam}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load rooms.
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Prices are entered in <strong>pounds</strong> — e.g. £75.00. Use <strong>Fixed price</strong> for a flat rate,
          or set hourly / half-day / full-day rates. The <strong>Price note</strong> appears on the public booking page
          below the price (e.g. "Standard hire: 4 hours, 19:00–23:00. Additional fees apply for longer periods.").
        </p>

        {/* Add new room */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" /> Add a new room
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRoom} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="new-name">Room name *</Label>
                  <Input id="new-name" name="name" placeholder="e.g. Main Function Room" required />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="new-desc">Description</Label>
                  <textarea
                    id="new-desc"
                    name="description"
                    rows={2}
                    placeholder="Optional description shown on the public page"
                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cap">Capacity (max guests)</Label>
                  <Input id="new-cap" name="capacity" type="number" min="1" placeholder="e.g. 100" />
                </div>
              </div>
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 lg:min-h-0 lg:w-auto lg:justify-start"
              >
                <Plus className="h-3.5 w-3.5" /> Create room
              </button>
            </form>
          </CardContent>
        </Card>

        {(rooms ?? []).length === 0 && !error && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No rooms configured yet.
            </CardContent>
          </Card>
        )}

        {(rooms ?? []).map((room) => {
          async function save(formData: FormData) {
            "use server";
            formData.set("id", room.id);
            await updateRoom(formData);
          }

          const isSaved = saved === room.id;

          return (
            <Card key={room.id} className={isSaved ? "border-emerald-300" : ""}>
              <CardHeader>
                <CardTitle className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{room.name}</span>
                    {isSaved && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                  </span>
                  <DeleteRoomButton roomId={room.id} roomName={room.name} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={save} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`name-${room.id}`}>Room name</Label>
                      <Input id={`name-${room.id}`} name="name" defaultValue={room.name} required />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`desc-${room.id}`}>Description</Label>
                      <textarea
                        id={`desc-${room.id}`}
                        name="description"
                        rows={2}
                        defaultValue={room.description ?? ""}
                        className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`cap-${room.id}`}>Capacity (max guests)</Label>
                      <Input id={`cap-${room.id}`} name="capacity" type="number" min="1" defaultValue={room.capacity ?? ""} placeholder="e.g. 100" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`active-${room.id}`}>Visibility</Label>
                      <select
                        id={`active-${room.id}`}
                        name="active"
                        defaultValue={room.active ? "true" : "false"}
                        className="min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm lg:min-h-0"
                      >
                        <option value="true">Visible on public page</option>
                        <option value="false">Hidden</option>
                      </select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`res-${room.id}`}>Resources <span className="text-muted-foreground text-xs font-normal">comma-separated, e.g. Projector, PA system</span></Label>
                      <Input
                        id={`res-${room.id}`}
                        name="amenities"
                        defaultValue={room.amenities.join(", ")}
                        placeholder="e.g. Projector, PA system, Whiteboard"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`sp-${room.id}`}>Standard hire (£)</Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`sp-${room.id}`} name="standard_price_pence" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.standard_price_pence)} placeholder="e.g. 150.00" className="pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`sh-${room.id}`}>Standard hours <span className="text-muted-foreground text-xs font-normal">covered by the standard hire</span></Label>
                      <Input id={`sh-${room.id}`} name="standard_hours" type="number" min="0.5" step="0.5" defaultValue={room.standard_hours ?? ""} placeholder="e.g. 4.5" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`eh-${room.id}`}>Each extra half hour (£) <span className="text-muted-foreground text-xs font-normal">any started half hour counts</span></Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`eh-${room.id}`} name="extra_hour_pence" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.extra_hour_pence)} placeholder="e.g. 25.00" className="pl-7" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`hr-${room.id}`}>Hourly rate (£) <span className="text-muted-foreground text-xs font-normal">fallback if no standard hire</span></Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`hr-${room.id}`} name="price_pence_per_hour" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.price_pence_per_hour)} placeholder="e.g. 25.00" className="pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`hd-${room.id}`}>Half-day rate (£) <span className="text-muted-foreground text-xs font-normal">up to 3.5 hrs</span></Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`hd-${room.id}`} name="price_pence_half_day" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.price_pence_half_day)} placeholder="e.g. 75.00" className="pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`fd-${room.id}`}>Full-day rate (£) <span className="text-muted-foreground text-xs font-normal">7+ hrs</span></Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`fd-${room.id}`} name="price_pence_full_day" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.price_pence_full_day)} placeholder="e.g. 125.00" className="pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`fx-${room.id}`}>Fixed price (£) <span className="text-muted-foreground text-xs font-normal">flat rate, any duration</span></Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                        <Input id={`fx-${room.id}`} name="price_pence_fixed" type="number" min="0" step="0.01" defaultValue={penceToPounds(room.price_pence_fixed)} placeholder="e.g. 200.00" className="pl-7" />
                      </div>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`pn-${room.id}`}>Price note <span className="text-muted-foreground text-xs font-normal">shown to bookers below the price</span></Label>
                      <Input
                        id={`pn-${room.id}`}
                        name="price_note"
                        defaultValue={room.price_note ?? ""}
                        placeholder="e.g. Standard hire: 4 hours (19:00–23:00). Additional fees apply for longer periods."
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="min-h-[44px] w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 lg:min-h-0 lg:w-auto"
                  >
                    Save changes
                  </button>
                </form>

                <div className="mt-6 border-t pt-4">
                  <p className="mb-3 text-sm font-medium">Optional extras</p>
                  <ExtrasEditor roomId={room.id} config={parseExtrasConfig(room.extras_config)} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
