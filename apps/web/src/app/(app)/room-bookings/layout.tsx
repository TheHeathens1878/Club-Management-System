import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";

import { SectionHomeLink } from "@/components/section-home-link";

// Every room-booking screen shares the way back to the room bookings home.
// Authorisation stays per-page — a layout is not a guard.
export default function RoomBookingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionHomeLink href="/room-bookings" label="Room bookings home" icon={CalendarDays} />
      {children}
    </>
  );
}
