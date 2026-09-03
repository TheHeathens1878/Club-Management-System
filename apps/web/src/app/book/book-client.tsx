"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitBooking } from "./actions";
import { formatCurrency } from "@/lib/utils";
import { poundsLabel, type ExtraConfig } from "@/lib/booking-extras";

type Room = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  price_pence_per_hour: number | null;
  price_pence_half_day: number | null;
  price_pence_full_day: number | null;
  /** The room's optional extras (Adam, 2026-09-03, reinstated). */
  extras: ExtraConfig[];
};

type BookedSlot = {
  resource_id: string;
  date: string;
  start_time: string;
  end_time: string;
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function calcEstimate(room: Room, startTime: string, endTime: string): number | null {
  if (!startTime || !endTime) return null;
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  if (endMin <= startMin) return null;
  const hours = (endMin - startMin) / 60;
  if (hours >= 7 && room.price_pence_full_day) return room.price_pence_full_day;
  if (hours >= 3.5 && room.price_pence_half_day) return room.price_pence_half_day;
  if (room.price_pence_per_hour) return Math.ceil(hours * room.price_pence_per_hour);
  return null;
}

function getDayStatus(slots: BookedSlot[], roomId: string, dateStr: string): "free" | "partial" | "full" {
  const daySlots = slots.filter((s) => s.resource_id === roomId && s.date === dateStr);
  if (daySlots.length === 0) return "free";
  const totalBooked = daySlots.reduce((acc, s) => acc + (toMin(s.end_time) - toMin(s.start_time)), 0);
  return totalBooked >= 8 * 60 ? "full" : "partial";
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function dateStr(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

export function BookClient({
  rooms,
  bookedSlots,
  teamNames = [],
}: {
  rooms: Room[];
  bookedSlots: BookedSlot[];
  teamNames?: string[];
}) {
  const router = useRouter();
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("23:00");
  const [bookerFirstName, setBookerFirstName] = useState("");
  const [bookerLastName, setBookerLastName] = useState("");
  const [bookerEmail, setBookerEmail] = useState("");
  const [bookerPhone, setBookerPhone] = useState("");
  const [occasionType, setOccasionType] = useState("");
  const [occasionOther, setOccasionOther] = useState("");
  const [birthdayAge, setBirthdayAge] = useState("");
  const [estimatedGuests, setEstimatedGuests] = useState("");
  // Chosen extras, keyed by the extra's id: an option label for a choice,
  // true for a binary yes. Prices shown here are the menu's; the server
  // re-prices from the room's own config either way.
  const [extras, setExtras] = useState<Record<string, string | boolean>>({});
  const [notes, setNotes] = useState("");
  // The member-discount claim (Adam, 2026-09-03: "the child and child's team
  // was for member discount" … "Players and social members also get member
  // discount"). Three ways in, all claims, none priced automatically: the
  // desk checks them against the club's records and records the discount at
  // confirmation.
  const [connection, setConnection] = useState<"none" | "family" | "player" | "social">("none");
  const [childName, setChildName] = useState("");
  const [childTeam, setChildTeam] = useState("");
  const [playerTeam, setPlayerTeam] = useState("");
  const [memberNumber, setMemberNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); }

  const gridDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = (firstDay.getDay() + 6) % 7;
    const days: Date[] = [];
    for (let i = startPad - 1; i >= 0; i--) days.push(new Date(year, month, -i));
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    while (days.length < 42) days.push(new Date(year, month + 1, days.length - lastDay.getDate() - startPad + 1));
    return days;
  }, [year, month]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);
  const estimate = selectedRoom ? calcEstimate(selectedRoom, startTime, endTime) : null;
  const extrasTotal = (selectedRoom?.extras ?? []).reduce((sum, extra) => {
    const value = extras[extra.id];
    if (extra.type === "binary") return value === true ? sum + extra.price_pence : sum;
    const option = extra.options.find((o) => o.label === value);
    return option ? sum + option.price_pence : sum;
  }, 0);

  const todayStr = dateStr(today);

  // "book" secures a slot (pending, conflict-checked); "enquiry" holds
  // NOTHING and says so everywhere (Adam, 2026-09-03, reinstated from the
  // old room app). Set by whichever button submits the form.
  const [intent, setIntent] = useState<"book" | "enquiry">("enquiry");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("room_id", selectedRoomId);
    fd.set("date", selectedDate ?? "");
    fd.set("start_time", startTime);
    fd.set("end_time", endTime);
    fd.set("booker_first_name", bookerFirstName);
    fd.set("booker_last_name", bookerLastName);
    fd.set("booker_email", bookerEmail);
    fd.set("booker_phone", bookerPhone);
    // The club's party rule (Adam, 2026-09-03, reinstated): no under-18
    // parties at all; an 18th is welcome and carries a £200 security deposit,
    // which the page has already said. The server refuses under-18s again —
    // this just saves the round trip.
    if (occasionType === "Birthday") {
      const age = Number(birthdayAge);
      if (Number.isFinite(age) && age > 0 && age < 18) {
        setError("Sorry — we don't take bookings for under-18 birthday parties.");
        setLoading(false);
        return;
      }
      if (birthdayAge.trim()) fd.set("birthday_age", birthdayAge.trim());
    }
    const occasionFinal = occasionType === "Other"
      ? occasionOther.trim()
      : occasionType === "Birthday" && birthdayAge.trim()
      ? `Birthday (age ${birthdayAge.trim()})`
      : occasionType;
    fd.set("occasion", occasionFinal);
    if (estimatedGuests) fd.set("estimated_guests", estimatedGuests);
    fd.set("notes", notes);
    if (Object.keys(extras).length > 0) fd.set("extras_selected", JSON.stringify(extras));
    if (connection !== "none") {
      fd.set("club_connection", connection);
      if (connection === "family") {
        fd.set("child_name", childName);
        fd.set("child_team", childTeam);
      }
      if (connection === "player") fd.set("player_team", playerTeam);
      if (connection === "social") fd.set("member_number", memberNumber);
    }

    try {
      const result = await submitBooking(fd);
      if ("error" in result) {
        setError(result.error);
        setLoading(false);
        return;
      }
      if ("url" in result) {
        router.push(result.url);
        return;
      }
      router.push(`/book/${result.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Room selector */}
      {rooms.length > 1 && (
        <div className="flex flex-wrap gap-2 px-4 sm:px-0">
          {rooms.map((r) => (
            <button
              key={r.id}
              onClick={() => { setSelectedRoomId(r.id); setExtras({}); }}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                selectedRoomId === r.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted/50"
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {/* Calendar */}
      <div className="rounded-none sm:rounded-lg border-y sm:border overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <button onClick={prevMonth} className="rounded-md p-1.5 hover:bg-muted transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="rounded-md p-1.5 hover:bg-muted transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 bg-muted/20">
          {DAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 divide-x divide-y border-t">
          {gridDays.map((day, i) => {
            const isCurrentMonth = day.getMonth() === month;
            const ds = dateStr(day);
            const isPast = ds < todayStr;
            const status = getDayStatus(bookedSlots, selectedRoomId, ds);
            const isSelected = ds === selectedDate;
            const daySlots = bookedSlots
              .filter((s) => s.resource_id === selectedRoomId && s.date === ds)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));

            let statusClass = "";
            if (!isPast && isCurrentMonth) {
              if (status === "free") statusClass = "bg-emerald-50 hover:bg-emerald-100 cursor-pointer";
              else if (status === "partial") statusClass = "bg-amber-50 hover:bg-amber-100 cursor-pointer";
              else statusClass = "bg-red-50 cursor-not-allowed";
            }

            function handleClick() {
              if (!isPast && isCurrentMonth && status !== "full") {
                setSelectedDate(ds);
                setTimeout(() => {
                  document.getElementById("booking-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }
            }

            return (
              <div
                key={i}
                onClick={handleClick}
                onDoubleClick={handleClick}
                className={`min-h-[68px] sm:min-h-[84px] p-1 transition-colors ${isCurrentMonth ? "" : "opacity-30"} ${statusClass} ${isSelected ? "ring-2 ring-inset ring-primary" : ""}`}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium
                  ${ds === todayStr ? "bg-primary text-primary-foreground" : isCurrentMonth ? "text-foreground" : "text-muted-foreground"}`}>
                  {day.getDate()}
                </div>
                {isCurrentMonth && !isPast && daySlots.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {daySlots.map((s, j) => (
                      <span key={j} className="block rounded bg-red-100 text-red-700 leading-tight py-0.5">
                        <span className="hidden sm:block truncate px-0.5 text-[10px] font-medium">
                          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                        </span>
                        <span className="sm:hidden flex justify-center">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block my-0.5" />
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t bg-muted/10 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" />Available</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-100 border border-amber-300 inline-block" />Partially booked</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-100 border border-red-300 inline-block" />Fully booked</span>
        </div>
      </div>

      {/* Booking form */}
      {selectedDate && (
        <div className="px-4 sm:px-0">
        <Card id="booking-form">
          <CardHeader>
            <CardTitle>Request this date</CardTitle>
            <p className="text-sm text-muted-foreground">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {selectedRoom && <span className="ml-2 font-medium text-foreground">· {selectedRoom.name}</span>}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="start_time">Start time *</Label>
                  <Input
                    id="start_time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_time">End time *</Label>
                  <Input
                    id="end_time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              {estimate !== null && estimate > 0 && (
                <div className="rounded-md bg-primary/5 border border-primary/20 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Estimated price: </span>
                  <span className="font-semibold text-primary">{formatCurrency(estimate)}</span>
                  <span className="text-muted-foreground ml-1">(subject to confirmation)</span>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="booker_first_name">First name *</Label>
                  <Input
                    id="booker_first_name"
                    value={bookerFirstName}
                    onChange={(e) => setBookerFirstName(e.target.value)}
                    placeholder="First name"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booker_last_name">Last name *</Label>
                  <Input
                    id="booker_last_name"
                    value={bookerLastName}
                    onChange={(e) => setBookerLastName(e.target.value)}
                    placeholder="Last name"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booker_email">Email address *</Label>
                  <Input
                    id="booker_email"
                    type="email"
                    value={bookerEmail}
                    onChange={(e) => setBookerEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booker_phone">Mobile number *</Label>
                  <Input
                    id="booker_phone"
                    type="tel"
                    value={bookerPhone}
                    onChange={(e) => setBookerPhone(e.target.value)}
                    placeholder="e.g. 07700 900000"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="occasion_type">Occasion</Label>
                  <select
                    id="occasion_type"
                    value={occasionType}
                    onChange={(e) => { setOccasionType(e.target.value); setOccasionOther(""); setBirthdayAge(""); }}
                    className="h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Select occasion…</option>
                    <option value="Birthday">Birthday</option>
                    <option value="Anniversary">Anniversary</option>
                    <option value="Private party">Private party</option>
                    <option value="Corporate / Business meeting">Corporate / Business meeting</option>
                    <option value="Wake / Funeral reception">Wake / Funeral reception</option>
                    <option value="Christening / Naming ceremony">Christening / Naming ceremony</option>
                    <option value="Charity event">Charity event</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {occasionType === "Birthday" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="birthday_age">Age being celebrated *</Label>
                    <Input
                      id="birthday_age"
                      type="number"
                      min="1"
                      value={birthdayAge}
                      onChange={(e) => setBirthdayAge(e.target.value)}
                      placeholder="e.g. 50"
                      required
                    />
                    {Number(birthdayAge) > 0 && Number(birthdayAge) < 18 ? (
                      <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        Sorry — we don&apos;t take bookings for under-18 birthday parties.
                      </p>
                    ) : Number(birthdayAge) === 18 ? (
                      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        18th birthday parties are welcome — please note they carry a{" "}
                        <strong>£200 refundable security deposit</strong>, payable before the
                        event and returned after it if all is well.
                      </p>
                    ) : null}
                  </div>
                )}
                {occasionType === "Other" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="occasion_other">Please describe *</Label>
                    <Input
                      id="occasion_other"
                      value={occasionOther}
                      onChange={(e) => setOccasionOther(e.target.value)}
                      placeholder="Describe your occasion…"
                      required
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="estimated_guests">Estimated guests</Label>
                  <Input
                    id="estimated_guests"
                    type="number"
                    min="1"
                    value={estimatedGuests}
                    onChange={(e) => setEstimatedGuests(e.target.value)}
                    placeholder="Approx. number"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">Additional notes</Label>
                  <textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any requirements or questions…"
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              {selectedRoom && selectedRoom.extras.length > 0 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Optional extras</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedRoom.extras.map((extra) =>
                      extra.type === "binary" ? (
                        <label
                          key={extra.id}
                          className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={extras[extra.id] === true}
                            onChange={(e) =>
                              setExtras((current) => ({ ...current, [extra.id]: e.target.checked }))
                            }
                            className="h-4 w-4"
                          />
                          <span className="flex-1">{extra.name}</span>
                          <span className="text-muted-foreground">{poundsLabel(extra.price_pence)}</span>
                        </label>
                      ) : (
                        <div key={extra.id} className="space-y-1.5">
                          <Label htmlFor={`extra-${extra.id}`}>{extra.name}</Label>
                          <select
                            id={`extra-${extra.id}`}
                            value={typeof extras[extra.id] === "string" ? (extras[extra.id] as string) : ""}
                            onChange={(e) =>
                              setExtras((current) => ({ ...current, [extra.id]: e.target.value }))
                            }
                            className="h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {extra.options.map((option) => (
                              <option key={option.label} value={option.label}>
                                {option.label}
                                {option.price_pence > 0 ? ` — ${poundsLabel(option.price_pence)}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      ),
                    )}
                  </div>
                  {extrasTotal > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Extras: <span className="font-medium text-foreground">{formatCurrency(extrasTotal)}</span>
                      {estimate !== null && (
                        <> · Estimated total:{" "}
                          <span className="font-medium text-foreground">{formatCurrency(estimate + extrasTotal)}</span>
                        </>
                      )}
                    </p>
                  )}
                </fieldset>
              )}

              {error && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
              )}

              {/* The choice comes BEFORE the button, as two equal cards
                  (Adam, 2026-09-03: an orange button with a white afterthought
                  underneath "is not clear enough"). Radio semantics so a
                  keyboard and a screen reader get a real either/or, and the
                  one submit button says exactly which of the two it is about
                  to do. */}
              <fieldset className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">Club connection — member discount</legend>
                <p className="text-xs text-muted-foreground">
                  Players, parents of club players and social members all get a member discount.
                  Tell us your connection and we&apos;ll check it and apply the discount to your
                  price.
                </p>
                <select
                  value={connection}
                  onChange={(e) => setConnection(e.target.value as typeof connection)}
                  aria-label="Club connection"
                  className="h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="none">No club connection</option>
                  <option value="player">I play for the club</option>
                  <option value="family">A child in my family plays for the club</option>
                  <option value="social">I&apos;m a social member</option>
                </select>

                {connection === "player" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="player_team">Your team *</Label>
                    <Input
                      id="player_team"
                      value={playerTeam}
                      onChange={(e) => setPlayerTeam(e.target.value)}
                      placeholder="e.g. Vets"
                      list="club-team-names"
                      required
                    />
                  </div>
                )}

                {connection === "family" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="child_name">Child&apos;s name *</Label>
                      <Input
                        id="child_name"
                        value={childName}
                        onChange={(e) => setChildName(e.target.value)}
                        placeholder="e.g. Alex Smith"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="child_team">Their team *</Label>
                      <Input
                        id="child_team"
                        value={childTeam}
                        onChange={(e) => setChildTeam(e.target.value)}
                        placeholder="e.g. U12 Lions"
                        list="club-team-names"
                        required
                      />
                    </div>
                  </div>
                )}

                {connection === "social" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="member_number">Membership number (if you have it)</Label>
                    <Input
                      id="member_number"
                      value={memberNumber}
                      onChange={(e) => setMemberNumber(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                )}

                <datalist id="club-team-names">
                  {teamNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </fieldset>

              {/* The estimated cost, always on show (Adam, 2026-09-03:
                  "Build in the estimated costs") — the same tier maths the
                  server re-runs, plus the extras, minus nothing: the member
                  discount is applied by a person after the claim is checked,
                  and the note says so. */}
              {estimate !== null && estimate > 0 && (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Room hire ({startTime}–{endTime})</span>
                    <span>{formatCurrency(estimate)}</span>
                  </div>
                  {extrasTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Extras</span>
                      <span>{formatCurrency(extrasTotal)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                    <span>Estimated total</span>
                    <span>{formatCurrency(estimate + extrasTotal)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    An estimate, confirmed with your booking.
                    {connection !== "none"
                      ? " Your member discount is applied once we've checked your club connection."
                      : ""}
                  </p>
                </div>
              )}

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  What would you like to send?
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">

                  <label
                    className={
                      "flex cursor-pointer flex-col gap-1 rounded-lg border-2 p-4 transition " +
                      (intent === "enquiry"
                        ? "border-amber-500 bg-amber-50"
                        : "border-input bg-card hover:border-muted-foreground/40")
                    }
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="send_as"
                        checked={intent === "enquiry"}
                        onChange={() => setIntent("enquiry")}
                        className="h-4 w-4 accent-amber-600"
                      />
                      <span className="text-sm font-semibold">Enquiry only</span>
                    </span>
                    <span
                      className={
                        "text-xs " +
                        (intent === "enquiry" ? "text-amber-900" : "text-muted-foreground")
                      }
                    >
                      Just a question about this date — the room is{" "}
                      <strong>not held for you</strong>, and the date stays open to other bookings
                      until you confirm one with us.
                    </span>
                  </label>
                  <label
                    className={
                      "flex cursor-pointer flex-col gap-1 rounded-lg border-2 p-4 transition " +
                      (intent === "book"
                        ? "border-primary bg-primary/5"
                        : "border-input bg-card hover:border-muted-foreground/40")
                    }
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="send_as"
                        checked={intent === "book"}
                        onChange={() => setIntent("book")}
                        className="h-4 w-4 accent-current"
                      />
                      <span className="text-sm font-semibold">Booking request</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      We&apos;ll confirm availability and the total with you — the date is reserved
                      for you once it&apos;s confirmed and the deposit is paid.
                    </span>
                  </label>
                </div>
              </fieldset>

              <Button
                type="submit"
                className={
                  "w-full " +
                  (intent === "enquiry" ? "bg-amber-600 text-white hover:bg-amber-600/90" : "")
                }
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {intent === "enquiry" ? "Sending enquiry…" : "Submitting request…"}</>
                ) : intent === "enquiry" ? (
                  "Send enquiry — room not held"
                ) : (
                  "Send booking request"
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                {intent === "enquiry"
                  ? "We'll reply with availability and prices. Nothing is booked and nothing is held."
                  : "Your request will be reviewed by our team. We'll be in touch to confirm availability and arrange payment."}
              </p>
            </form>
          </CardContent>
        </Card>
        </div>
      )}

      {!selectedDate && (
        <p className="text-center text-sm text-muted-foreground py-4">
          Click a date on the calendar above to start your booking request.
        </p>
      )}
    </div>
  );
}
