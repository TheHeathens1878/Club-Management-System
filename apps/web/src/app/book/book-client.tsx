"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { submitBooking } from "./actions";
import { formatCurrency } from "@/lib/utils";

type Room = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  price_pence_per_hour: number | null;
  price_pence_half_day: number | null;
  price_pence_full_day: number | null;
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

export function BookClient({ rooms, bookedSlots }: { rooms: Room[]; bookedSlots: BookedSlot[] }) {
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
  const [notes, setNotes] = useState("");
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

  const todayStr = dateStr(today);

  // "book" secures a slot (pending, conflict-checked); "enquiry" holds
  // NOTHING and says so everywhere (Adam, 2026-09-03, reinstated from the
  // old room app). Set by whichever button submits the form.
  const [intent, setIntent] = useState<"book" | "enquiry">("book");

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
    const occasionFinal = occasionType === "Other"
      ? occasionOther.trim()
      : occasionType === "Birthday" && birthdayAge.trim()
      ? `Birthday (age ${birthdayAge.trim()})`
      : occasionType;
    fd.set("occasion", occasionFinal);
    if (estimatedGuests) fd.set("estimated_guests", estimatedGuests);
    fd.set("notes", notes);

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
              onClick={() => setSelectedRoomId(r.id)}
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

              {error && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                onClick={() => setIntent("book")}
              >
                {loading && intent === "book" ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</>
                ) : (
                  "Request booking"
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Your request will be reviewed by our team. We&apos;ll be in touch to confirm availability and arrange payment.
              </p>

              {/* Not ready to commit: the same details go to the club as a
                  question, not a request — and nothing is held. */}
              <div className="rounded-lg border border-dashed p-4 text-center">
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={() => setIntent("enquiry")}
                >
                  {loading && intent === "enquiry" ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</>
                  ) : (
                    "Just send an enquiry instead"
                  )}
                </Button>
                <p className="mt-2 text-xs text-amber-700">
                  An enquiry does <strong>not</strong> hold the room — the date stays open to other
                  bookings until you confirm one with us.
                </p>
              </div>
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
