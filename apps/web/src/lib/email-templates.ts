import { getSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/template-engine";
import { getEmailBrandColor } from "@/lib/settings";

const DEFAULT_COLOR = "#1249bf";

async function layout(body: string, brandColor: string): Promise<string> {
  const { club_name } = await getSettings();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${brandColor};padding:24px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${club_name}</h1>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">${club_name}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function magicLinkEmail(params: { linkUrl: string; brandColor?: string }) {
  const color = params.brandColor ?? DEFAULT_COLOR;
  const { club_name } = await getSettings();
  const html = await layout(`
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      You requested a sign-in link for the ${club_name} booking system.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
      <tr><td style="background:${color};border-radius:8px;padding:12px 28px;">
        <a href="${params.linkUrl}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">Sign In</a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or copy this link into your browser:</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280;word-break:break-all;">${params.linkUrl}</p>
    <p style="margin:0;font-size:13px;color:#9ca3af;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
  `, color);

  return {
    subject: `Sign in to ${club_name}`,
    html,
    text: `Sign in to ${club_name}\n\nClick here to sign in: ${params.linkUrl}\n\nThis link expires in 1 hour.`,
  };
}

export async function passwordResetEmail(params: { linkUrl: string; brandColor?: string }) {
  const color = params.brandColor ?? DEFAULT_COLOR;
  const { club_name } = await getSettings();
  const html = await layout(`
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">
      You requested a password reset for your ${club_name} account.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
      <tr><td style="background:${color};border-radius:8px;padding:12px 28px;">
        <a href="${params.linkUrl}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">Reset Password</a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Or copy this link into your browser:</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280;word-break:break-all;">${params.linkUrl}</p>
    <p style="margin:0;font-size:13px;color:#9ca3af;">This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.</p>
  `, color);

  return {
    subject: `${club_name} — password reset link`,
    html,
    text: `Reset your password\n\nClick here: ${params.linkUrl}\n\nThis link expires in 1 hour.`,
  };
}

export async function roomBookingConfirmedEmail(params: {
  bookerName: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  occasion: string | null;
  paymentStatus: string;
  brandColor?: string;
}) {
  const color = params.brandColor ?? await getEmailBrandColor().catch(() => DEFAULT_COLOR);
  return renderEmailTemplate(
    "room_booking_confirmed",
    {
      name: params.bookerName,
      room_name: params.roomName,
      booking_date: params.date,
      start_time: params.startTime,
      end_time: params.endTime,
      occasion: params.occasion ?? "—",
      payment_status: params.paymentStatus,
    },
    color,
  );
}

export async function roomBookingCancelledEmail(params: {
  bookerName: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  cancellationReason: string;
  brandColor?: string;
}) {
  const color = params.brandColor ?? await getEmailBrandColor().catch(() => DEFAULT_COLOR);
  return renderEmailTemplate(
    "room_booking_cancelled",
    {
      name: params.bookerName,
      room_name: params.roomName,
      booking_date: params.date,
      start_time: params.startTime,
      end_time: params.endTime,
      cancellation_reason: params.cancellationReason,
    },
    color,
  );
}

export async function roomBookingReceivedEmail(params: {
  bookerName: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  occasion: string | null;
  brandColor?: string;
}) {
  const color = params.brandColor ?? await getEmailBrandColor().catch(() => DEFAULT_COLOR);
  return renderEmailTemplate(
    "room_booking_received",
    {
      name: params.bookerName,
      room_name: params.roomName,
      booking_date: params.date,
      start_time: params.startTime,
      end_time: params.endTime,
      occasion: params.occasion ?? "—",
    },
    color,
  );
}

export async function roomBookingNotificationEmail(params: {
  bookerName: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  occasion: string | null;
  estimatedGuests: number | null;
  notes: string | null;
  bookingUrl: string;
  brandColor?: string;
  /** An enquiry only — the slot is not held, and the subject line says so. */
  enquiry?: boolean;
}) {
  const color = params.brandColor ?? DEFAULT_COLOR;
  const { club_name } = await getSettings();
  const kind = params.enquiry ? "enquiry" : "booking request";

  const rows = [
    { label: "Booker", value: params.bookerName },
    { label: "Room", value: params.roomName },
    { label: "Date", value: params.date },
    { label: "Time", value: `${params.startTime} – ${params.endTime}` },
    params.occasion && { label: "Occasion", value: params.occasion },
    params.estimatedGuests && { label: "Est. guests", value: String(params.estimatedGuests) },
    params.notes && { label: "Notes", value: params.notes },
  ].filter(Boolean) as { label: string; value: string }[];

  const table = `<table role="presentation" width="100%" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    ${rows.map((r, i) => `<tr${i % 2 === 0 ? ' style="background:#f9fafb;"' : ''}>
      <td style="padding:8px 16px;font-size:13px;color:#6b7280;width:130px;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${r.label}</td>
      <td style="padding:8px 16px;font-size:14px;color:#374151;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${r.value}</td>
    </tr>`).join("")}
  </table>`;

  const html = await layout(`
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">A new room ${kind} has been received.${params.enquiry ? " It does not hold the slot — the date stays open until someone confirms a booking." : ""}</p>
    ${table}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
      <tr><td style="background:${color};border-radius:8px;padding:12px 28px;">
        <a href="${params.bookingUrl}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">View Booking</a>
      </td></tr>
    </table>
  `, color);

  const textRows = rows.map((r) => `  ${r.label}: ${r.value}`).join("\n");

  return {
    subject: `New room ${kind} — ${params.bookerName} (${params.date})`,
    html,
    text: `New room ${kind}\n\n${textRows}\n\nView: ${params.bookingUrl}`,
  };
}
