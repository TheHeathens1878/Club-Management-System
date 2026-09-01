"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLegacyAdminClient } from "@/lib/supabase/legacy";
import { getSiteUrl } from "@/lib/utils";
import { sendEmail } from "@/lib/email";
import { roomBookingNotificationEmail } from "@/lib/email-templates";
import { getEmailBrandColor, getRecipientEmails, getSettings } from "@/lib/settings";
import {
  formatBookingDate,
  isValidDateString,
  isValidTimeString,
  legacyWindowToInstants,
} from "@/lib/booking-time";
import { bookingPeriod, FUNCTION_ROOM } from "@/lib/booking-types";
import { upsertBookingContact } from "@/lib/booking-contacts";
import { conflictOrMessage, slotHasConflict, SLOT_TAKEN_MESSAGE } from "@/lib/booking-conflict";

type AdminClient = ReturnType<typeof createAdminClient>;

// Ensure the booker has an account so they can access the portal.
// New accounts are created as 'booker' with a set-password flow; existing
// accounts (staff/member/returning booker) are linked but never downgraded.
async function ensureBookerAccount(
  admin: AdminClient,
  email: string,
  fullName: string,
): Promise<{ userId: string | null; isNew: boolean }> {
  const { data: created } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { needs_password: true, full_name: fullName },
  });
  if (created?.user) {
    // `booker` is not a value of the `user_role` enum in the current schema —
    // P0.4 lift-and-shift debt, untouched here. See lib/supabase/legacy.ts.
    await createLegacyAdminClient().from("profiles").upsert(
      { id: created.user.id, role: "booker", full_name: fullName },
      { onConflict: "id" },
    );
    return { userId: created.user.id, isNew: true };
  }
  // Already registered — find their id without touching their role
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return { userId: existing?.id ?? null, isNew: false };
}

function bookerEmailHtml(intro: string, brandColor: string, clubName: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${brandColor};padding:24px 32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">${clubName}</h1>
        </td></tr>
        <tr><td style="padding:32px;font-size:15px;color:#374151;line-height:1.6;">${intro}</td></tr>
        <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">${clubName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function calcAmount(
  room: {
    price_pence_per_hour: number | null;
    price_pence_half_day: number | null;
    price_pence_full_day: number | null;
  },
  startTime: string,
  endTime: string
): number {
  const startMin = parseTime(startTime);
  const endMin = parseTime(endTime);
  const durationMins = endMin - startMin;
  if (durationMins <= 0) return 0;
  const durationHours = durationMins / 60;

  if (durationHours >= 7 && room.price_pence_full_day) {
    return room.price_pence_full_day;
  }
  if (durationHours >= 3.5 && room.price_pence_half_day) {
    return room.price_pence_half_day;
  }
  if (room.price_pence_per_hour) {
    return Math.ceil(durationHours * room.price_pence_per_hour);
  }
  return 0;
}

export async function submitBooking(
  formData: FormData
): Promise<{ id: string } | { url: string } | { error: string }> {
  const admin = createAdminClient();

  const roomId = String(formData.get("room_id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const startTime = String(formData.get("start_time") ?? "").trim();
  const endTime = String(formData.get("end_time") ?? "").trim();
  const bookerFirstName = String(formData.get("booker_first_name") ?? "").trim();
  const bookerLastName = String(formData.get("booker_last_name") ?? "").trim();
  const bookerName = `${bookerFirstName} ${bookerLastName}`.trim();
  const bookerEmail = String(formData.get("booker_email") ?? "").trim();
  const bookerPhone = String(formData.get("booker_phone") ?? "").trim() || null;
  const occasion = String(formData.get("occasion") ?? "").trim() || null;
  const estimatedGuestsRaw = formData.get("estimated_guests");
  const estimatedGuests = estimatedGuestsRaw ? Number(estimatedGuestsRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!roomId) return { error: "Please select a room." };
  if (!date) return { error: "Please select a date." };
  if (!startTime) return { error: "Please enter a start time." };
  if (!endTime) return { error: "Please enter an end time." };
  if (!bookerFirstName) return { error: "Please enter your first name." };
  if (!bookerLastName) return { error: "Please enter your last name." };
  if (!bookerEmail) return { error: "Please enter your email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail)) return { error: "Please enter a valid email address." };
  if (!bookerPhone) return { error: "Please enter your phone number." };
  if (!isValidDateString(date)) return { error: "Please select a valid date." };
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
    return { error: "Please enter valid start and end times." };
  }

  const startMin = parseTime(startTime);
  const endMin = parseTime(endTime);
  if (endMin <= startMin) return { error: "End time must be after start time." };

  const { data: room, error: roomErr } = await admin
    .from("resources")
    .select("id, name, price_pence_per_hour, price_pence_half_day, price_pence_full_day")
    .eq("id", roomId)
    .eq("type", FUNCTION_ROOM)
    .eq("active", true)
    .maybeSingle();

  if (roomErr || !room) return { error: "Room not found." };

  const { startsAt, endsAt } = legacyWindowToInstants(date, startTime, endTime);

  // `booking_has_conflict()` applies exactly the rule `bookings_no_overlap`
  // enforces, so the answer here and the constraint below cannot disagree
  // about an edge; the constraint still guards against a race.
  if (await slotHasConflict(admin, { resourceId: roomId, startsAt, endsAt })) {
    return { error: SLOT_TAKEN_MESSAGE };
  }

  const amountPence = calcAmount(room, startTime, endTime);

  // The room's own contacts book — NOT the members database. The snapshot
  // columns below stay the record of who booked; this only groups their hires.
  const contactId = await upsertBookingContact({
    name: bookerName,
    firstName: bookerFirstName,
    lastName: bookerLastName,
    email: bookerEmail,
    phone: bookerPhone,
  }).catch(() => null);

  const { data: booking, error: insertErr } = await admin
    .from("bookings")
    .insert({
      resource_id: roomId,
      ...bookingPeriod(startsAt, endsAt),
      contact_id: contactId,
      booker_first_name: bookerFirstName,
      booker_last_name: bookerLastName,
      booker_name: bookerName,
      booker_email: bookerEmail,
      booker_phone: bookerPhone,
      occasion,
      estimated_guests: estimatedGuests,
      notes,
      status: "pending",
      total_pence: amountPence > 0 ? amountPence : null,
      payment_status: "unpaid",
    })
    .select("id")
    .single();

  if (insertErr || !booking) {
    return {
      error: conflictOrMessage(insertErr, "Failed to save booking. Please try again."),
    };
  }

  // Create / link a booker account so they can access the portal
  const { userId: bookerId, isNew } = await ensureBookerAccount(admin, bookerEmail, bookerName)
    .catch(() => ({ userId: null as string | null, isNew: false }));
  if (bookerId) {
    await admin.from("bookings").update({ booker_profile_id: bookerId }).eq("id", booking.id);
  }

  // Send the booker their acknowledgement + portal access (async)
  (async () => {
    try {
      const [brandColor, { club_name }] = await Promise.all([
        getEmailBrandColor().catch(() => "#1249bf"),
        getSettings(),
      ]);
      const siteUrl = getSiteUrl();
      const dateFormatted = formatBookingDate(date);

      let accessLine = `<p>You can track your booking and pay online any time in your portal.</p>
<p><a href="${siteUrl}/portal" style="color:${brandColor};font-weight:600;">Open your booking portal →</a></p>`;
      if (isNew && bookerId) {
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: bookerEmail,
          options: { redirectTo: `${siteUrl}/auth/callback` },
        });
        if (linkData?.properties?.hashed_token) {
          const setLink = `${siteUrl}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink`;
          accessLine = `<p>We've set up a booking portal so you can track this request and pay online. Set your password to get started:</p>
<p><a href="${setLink}" style="color:${brandColor};font-weight:600;">Set your password &amp; open your portal →</a></p>`;
        }
      }

      const intro = `<p>Dear ${bookerFirstName},</p>
<p>Thank you for your booking request at ${club_name}. We've received it and will be in touch to confirm availability and the total cost.</p>
<p><strong>${room.name}</strong> · ${dateFormatted} · ${startTime}–${endTime}</p>
${accessLine}
<p style="font-size:13px;color:#6b7280;">If you didn't make this request, please contact us.</p>`;

      await sendEmail({
        to: bookerEmail,
        subject: `${club_name} — booking request received`,
        html: bookerEmailHtml(intro, brandColor, club_name),
        text: `Thank you for your booking request at ${club_name}. ${room.name} on ${dateFormatted}, ${startTime}-${endTime}. Access your portal: ${siteUrl}/portal`,
      });
    } catch (e) {
      console.error("[room-booking] Booker email failed:", e);
    }
  })();

  // Notify staff asynchronously — do not await to keep booking flow fast
  (async () => {
    try {
      const [brandColor, staffEmails] = await Promise.all([
        getEmailBrandColor().catch(() => "#1249bf"),
        getRecipientEmails("notify_booking_request"),
      ]);

      if (staffEmails.length > 0) {
        const bookingUrl = `${getSiteUrl()}/room-bookings/${booking.id}`;
        const dateFormatted = formatBookingDate(date);
        const tpl = await roomBookingNotificationEmail({
          bookerName,
          roomName: room.name,
          date: dateFormatted,
          startTime,
          endTime,
          occasion,
          estimatedGuests,
          notes,
          bookingUrl,
          brandColor,
        });
        await sendEmail({ to: staffEmails, ...tpl });
      }
    } catch (e) {
      console.error("[room-booking] Staff notification failed:", e);
    }
  })();

  return { id: booking.id };
}
