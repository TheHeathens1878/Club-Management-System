import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";

const DEFAULT_COLOR = "#1249bf";

export type TemplateKey =
  | "room_booking_confirmed"
  | "room_booking_cancelled"
  | "room_booking_received"
  | "payment_received"
  | "deposit_reminder"
  | "balance_reminder"
  | "password_set";

export type TemplateVariable = {
  key: string;
  label: string;
  example: string;
};

export type TemplateDef = {
  name: string;
  description: string;
  variables: TemplateVariable[];
  defaultSubject: (clubName: string) => string;
  defaultBody: (clubName: string) => string;
};

export const TEMPLATE_DEFINITIONS: Record<TemplateKey, TemplateDef> = {
  room_booking_received: {
    name: "Booking Request Received",
    description: "Sent to the booker when their booking request is submitted.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "occasion", label: "Occasion / event type", example: "Birthday party" },
    ],
    defaultSubject: (c) => `${c} — booking request received`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Thank you for your room booking request at ${c}. We have received your request and will be in touch to confirm availability.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Time:</strong> {{start_time}} – {{end_time}}</li>
<li><strong>Occasion:</strong> {{occasion}}</li>
</ul>
<p>If you have any questions, please contact us directly.</p>`,
  },

  room_booking_confirmed: {
    name: "Booking Confirmed",
    description: "Sent to the booker when their room booking is confirmed by staff.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "occasion", label: "Occasion / event type", example: "Birthday party" },
      { key: "payment_status", label: "Payment / deposit terms", example: "Subject to a £100 deposit by 14 June 2026." },
      { key: "total_cost", label: "Total cost", example: "£350.00" },
      { key: "deposit_amount", label: "Deposit required", example: "£100.00" },
      { key: "deposit_due_date", label: "Deposit due date", example: "14 June 2026" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — your room booking is confirmed`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>We are pleased to confirm your room booking at ${c}:</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Time:</strong> {{start_time}} – {{end_time}}</li>
<li><strong>Occasion:</strong> {{occasion}}</li>
<li><strong>Total cost:</strong> {{total_cost}}</li>
</ul>
<p>{{payment_status}}</p>
<p>You can pay your deposit or balance and view your booking any time in your portal:</p>
<p><a href="{{portal_url}}">Open your booking portal</a></p>
<p>If you have any questions or need to make changes, please contact us directly.</p>
<p>We look forward to welcoming you to the club.</p>`,
  },

  room_booking_cancelled: {
    name: "Booking Cancelled",
    description: "Sent to the booker when their room booking is cancelled by staff.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "cancellation_reason", label: "Reason for cancellation", example: "The room is unfortunately unavailable on this date." },
    ],
    defaultSubject: (c) => `${c} — your room booking has been cancelled`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>We regret to inform you that your room booking at ${c} has been cancelled:</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Time:</strong> {{start_time}} – {{end_time}}</li>
</ul>
<p><strong>Reason:</strong> {{cancellation_reason}}</p>
<p>We are sorry for any inconvenience caused. Please contact us if you would like to discuss alternative arrangements.</p>`,
  },

  payment_received: {
    name: "Payment Received",
    description: "Sent to the booker each time a payment is recorded against their booking.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "amount_paid", label: "Amount of this payment", example: "£100.00" },
      { key: "total_paid", label: "Total paid so far", example: "£100.00" },
      { key: "outstanding", label: "Balance outstanding", example: "£250.00" },
      { key: "payment_method", label: "Payment method", example: "Card" },
    ],
    defaultSubject: (c) => `${c} — payment received`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Thank you — we've received your payment towards your booking at ${c}.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Payment received:</strong> {{amount_paid}} ({{payment_method}})</li>
<li><strong>Total paid so far:</strong> {{total_paid}}</li>
<li><strong>Balance outstanding:</strong> {{outstanding}}</li>
</ul>
<p>If you have any questions about your booking or payments, please contact us.</p>`,
  },

  deposit_reminder: {
    name: "Deposit Reminder",
    description: "Sent automatically as the deposit deadline approaches if the deposit is still unpaid.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "deposit_amount", label: "Deposit required", example: "£100.00" },
      { key: "deposit_due_date", label: "Deposit due date", example: "7 June 2026" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — deposit reminder`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>This is a friendly reminder that the deposit for your booking at ${c} is due.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Deposit:</strong> {{deposit_amount}} due by {{deposit_due_date}}</li>
</ul>
<p>Please pay your deposit to secure your booking:</p>
<p><a href="{{portal_url}}">Pay your deposit</a></p>
<p>If you have already paid, please disregard this message.</p>`,
  },

  balance_reminder: {
    name: "Balance Reminder",
    description: "Sent automatically a set number of days before the event if the balance is not paid in full.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "outstanding", label: "Balance outstanding", example: "£250.00" },
      { key: "balance_due_date", label: "Balance due date", example: "31 May 2026" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — balance due for your upcoming booking`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Your event at ${c} is coming up and there is a balance outstanding on your booking.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Balance outstanding:</strong> {{outstanding}}</li>
<li><strong>Due by:</strong> {{balance_due_date}}</li>
</ul>
<p>Please settle the remaining balance:</p>
<p><a href="{{portal_url}}">Pay your balance</a></p>
<p>If you have already paid in full, please disregard this message.</p>`,
  },

  password_set: {
    name: "Portal Access",
    description: "Sent when a user account is created by an administrator.",
    variables: [
      { key: "name", label: "User name", example: "Jane Smith" },
      { key: "login_url", label: "Login URL", example: "https://portal.aomsportsclub.co.uk/login" },
    ],
    defaultSubject: (c) => `${c} — your account is ready`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>An account has been created for you on the ${c} booking system. You can now sign in using the link below.</p>
<p><a href="{{login_url}}">Sign in</a></p>
<p>If you did not expect this, please contact us.</p>`,
  },
};

export function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function emailLayout(body: string, brandColor: string, clubName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${brandColor};padding:24px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${clubName}</h1>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">${clubName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function styleBodyHtml(html: string): string {
  return html
    .replace(/<h1>/g, '<h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">')
    .replace(/<h2>/g, '<h2 style="margin:0 0 14px;font-size:18px;font-weight:700;color:#111827;">')
    .replace(/<h3>/g, '<h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#374151;">')
    .replace(/<p>/g, '<p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:24px;">')
    .replace(/<ol>/g, '<ol style="margin:0 0 14px;padding-left:24px;">')
    .replace(/<li>/g, '<li style="margin:0 0 6px;font-size:15px;color:#374151;">')
    .replace(/<a /g, '<a style="color:#1e40af;" ');
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/?(h[1-6]|p|li|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getTemplateContent(key: TemplateKey): Promise<{ subject: string; body: string }> {
  const admin = createAdminClient();
  const [{ data }, settings] = await Promise.all([
    admin.from("email_templates").select("subject,body_html").eq("key", key).maybeSingle(),
    getSettings(),
  ]);
  const def = TEMPLATE_DEFINITIONS[key];
  return {
    subject: data?.subject ?? def.defaultSubject(settings.club_name),
    body: data?.body_html ?? def.defaultBody(settings.club_name),
  };
}

export async function renderEmailTemplate(
  key: TemplateKey,
  vars: Record<string, string>,
  brandColor = DEFAULT_COLOR,
): Promise<{ subject: string; html: string; text: string }> {
  const settings = await getSettings();
  const { subject, body } = await getTemplateContent(key);
  const renderedSubject = substituteVars(subject, vars);
  const renderedBody = substituteVars(body, vars);
  const styledBody = styleBodyHtml(renderedBody);
  return {
    subject: renderedSubject,
    html: emailLayout(styledBody, brandColor, settings.club_name),
    text: htmlToPlainText(renderedBody),
  };
}
