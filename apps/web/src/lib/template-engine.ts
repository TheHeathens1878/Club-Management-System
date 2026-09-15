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
  | "room_booking_quote"
  | "quote_followup"
  | "room_booking_chaser"
  | "room_booking_final_chaser"
  | "room_booking_thank_you"
  | "fixture_reallocated"
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
      { key: "payment_status", label: "Payment terms, as they apply to this booking", example: "A non-refundable deposit of £100.00 secures the room and is due by 14 June 2026; the booking is confirmed subject to it. The balance of £250.00 is due by 1 July 2026, at least two weeks before your event." },
      { key: "total_cost", label: "Total cost", example: "£350.00" },
      { key: "deposit_amount", label: "Non-refundable deposit", example: "£100.00" },
      { key: "deposit_due_date", label: "Deposit due date", example: "14 June 2026" },
      { key: "balance_due_date", label: "Balance (and security deposit) due date", example: "1 July 2026" },
      { key: "security_deposit", label: "Refundable security deposit (— if none)", example: "£200.00" },
      { key: "member_info", label: "Member booking note (blank for a non-member)", example: "This is a member booking (Social, 00123): a member discount of £25.00 has been applied." },
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
<p><strong>How paying works:</strong> {{payment_status}}</p>
<p>The deposit is non-refundable and secures the room; the balance, plus any refundable security deposit, is due at least two weeks before your event. You can pay each of them and view your booking any time in your portal:</p>
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

  room_booking_quote: {
    name: "Quote Sent",
    description:
      "Sent when staff quote a price for an enquiry or request. The date is NOT held by a quote.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "total_cost", label: "Quoted total", example: "£350.00" },
      { key: "message", label: "Personal message typed by staff when sending (blank if none)", example: "We can also do a later finish if you need it." },
      { key: "deposit_terms", label: "The club's payment terms, in a sentence", example: "To secure the room a non-refundable deposit of half the total cost, up to £100.00 is paid first. The balance, plus any refundable security deposit, is due at least two weeks before the event." },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — your quote`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Thank you for your interest in hiring the {{room_name}} at ${c}. For {{booking_date}}, {{start_time}} – {{end_time}}, the price would be <strong>{{total_cost}}</strong>.</p>
{{message}}
<p>Please note the date is <strong>not held</strong> by this quote — it stays open to other bookings until you confirm one with us.</p>
<p>{{deposit_terms}}</p>
<p>To go ahead, accept the quote in your portal — the booking is then confirmed subject to the deposit, which you can pay there and then. Or reply to this email and we will confirm it with you.</p>
<p><a href="{{portal_url}}">Accept the quote in your portal</a></p>`,
  },

  quote_followup: {
    name: "Quote Follow-up",
    description: "Sent a few days after a quote if nothing has been confirmed.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "total_cost", label: "Quoted total", example: "£350.00" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — still interested in {{booking_date}}?`,
    defaultBody: () => `<p>Dear {{name}},</p>
<p>A few days ago we quoted <strong>{{total_cost}}</strong> for the {{room_name}} on {{booking_date}}. The date is still open — and still not held — so if you would like to go ahead, reply to this email or contact the club and we will confirm it for you.</p>
<p>If your plans have changed, no need to do anything.</p>
<p><a href="{{portal_url}}">View this in your portal</a></p>`,
  },

  room_booking_chaser: {
    name: "Chaser — still want the room?",
    description: "Sent by staff to an enquiry or a quoted booking that has gone quiet, asking whether they still want the room.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "price_line", label: "Price sentence (blank if nothing has been quoted)", example: "The price we quoted was £350.00." },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — do you still want the room on {{booking_date}}?`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>You asked about the <strong>{{room_name}}</strong> at ${c} on <strong>{{booking_date}}</strong>, {{start_time}} – {{end_time}}, and we have not heard back from you since.</p>
<p>{{price_line}}</p>
<p>Do you still want the room? The date is not held for you, so if you would like to go ahead please reply to this email or contact the club and we will confirm it. If your plans have changed, just let us know and we will close the enquiry.</p>
<p><a href="{{portal_url}}">View this in your portal</a></p>`,
  },

  room_booking_final_chaser: {
    name: "Final chaser — half off the room hire",
    description: "Sent once by staff as a last offer: the room hire is halved and the quote is amended to the new price before this goes.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "start_time", label: "Start time", example: "19:00" },
      { key: "end_time", label: "End time", example: "23:00" },
      { key: "original_cost", label: "Price before the offer", example: "£350.00" },
      { key: "discount", label: "Amount taken off (half the room hire)", example: "£150.00" },
      { key: "new_cost", label: "New total", example: "£200.00" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — a final offer on the room for {{booking_date}}`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>We still have the <strong>{{room_name}}</strong> at ${c} free on <strong>{{booking_date}}</strong>, {{start_time}} – {{end_time}}, and we would rather it was used than empty.</p>
<p>So here is a final offer: <strong>half off the room hire</strong>.</p>
<ul>
<li><strong>Price quoted:</strong> {{original_cost}}</li>
<li><strong>Less half the room hire:</strong> −{{discount}}</li>
<li><strong>New total:</strong> {{new_cost}}</li>
</ul>
<p>Your quote has been updated to the new total. The date is still not held for you — reply to this email or contact the club and we will confirm it at this price. If we do not hear from you, we will take it that your plans have changed.</p>
<p><a href="{{portal_url}}">View this in your portal</a></p>`,
  },

  room_booking_thank_you: {
    name: "Thank You (after the event)",
    description: "Sent the day after a confirmed booking has taken place.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
    ],
    defaultSubject: (c) => `Thank you from ${c}`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Thank you for holding your event in the {{room_name}} at ${c} on {{booking_date}} — we hope it went brilliantly.</p>
<p>We would love to welcome you back: if you ever want the room again, you know where we are.</p>`,
  },

  deposit_reminder: {
    name: "Deposit Reminder",
    description: "Sent automatically as the deposit deadline approaches if the deposit is still unpaid.",
    variables: [
      { key: "name", label: "Booker name", example: "Jane Smith" },
      { key: "room_name", label: "Room name", example: "Main Function Room" },
      { key: "booking_date", label: "Date", example: "Saturday, 14 June 2026" },
      { key: "deposit_amount", label: "Non-refundable deposit required", example: "£100.00" },
      { key: "deposit_due_date", label: "Deposit due date", example: "7 June 2026" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — deposit reminder`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>This is a friendly reminder that the deposit for your booking at ${c} is due. It is what secures the room for you — until it is paid the booking is confirmed subject to it, and a deposit not received by its due date cancels the booking.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Non-refundable deposit:</strong> {{deposit_amount}} due by {{deposit_due_date}}</li>
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
      { key: "security_deposit", label: "Refundable security deposit still to pay (— if none)", example: "£200.00" },
      { key: "security_deposit_line", label: "A ready-made list line for the security deposit (blank if none)", example: "<li><strong>Refundable security deposit still to pay:</strong> £200.00</li>" },
      { key: "balance_due_date", label: "Due date — at least two weeks before the event", example: "31 May 2026" },
      { key: "portal_url", label: "Booker portal link", example: "https://portal.aomsportsclub.co.uk/portal" },
    ],
    defaultSubject: (c) => `${c} — balance due for your upcoming booking`,
    defaultBody: (c) => `<p>Dear {{name}},</p>
<p>Your event at ${c} is coming up. The balance, plus any refundable security deposit, is due at least two weeks before the event — and here is what is still outstanding on your booking.</p>
<ul>
<li><strong>Room:</strong> {{room_name}}</li>
<li><strong>Date:</strong> {{booking_date}}</li>
<li><strong>Balance outstanding:</strong> {{outstanding}}</li>
{{security_deposit_line}}
<li><strong>Due by:</strong> {{balance_due_date}}</li>
</ul>
<p>Please settle what is outstanding:</p>
<p><a href="{{portal_url}}">Pay your balance</a></p>
<p>If you have already paid in full, please disregard this message.</p>`,
  },

  fixture_reallocated: {
    name: "Fixture Reallocated",
    description:
      "Sent to a team's coaches when a game they already had a pitch for is moved — a different pitch, kick-off, or both.",
    variables: [
      { key: "team_name", label: "Team name", example: "U12 Titans" },
      {
        key: "changes",
        label: "The moved games, one per line",
        example:
          "Sat 6 Sep, 09:30 v Timperley FC — Ashton Park – Pitch 1 → Dainewell Park – Pitch 2",
      },
    ],
    defaultSubject: (c) => `${c} — {{team_name}}: a game has moved`,
    defaultBody: (c) => `<p>Hello,</p>
<p>The following {{team_name}} home game(s) have been moved on the ${c} pitch calendar:</p>
<p>{{changes}}</p>
<p>The team's diary and everyone's notifications follow automatically — this is just so it never catches you out on the day.</p>`,
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

/**
 * Fill a template's {{placeholders}}. One the caller did not supply comes out
 * blank, not as the placeholder itself: a hirer's confirmation used to arrive
 * with "{{member_info}}" printed in it, a variable the club's customised
 * template asked for and the confirm path did not know (Adam, 2026-09-15). A
 * blank is a gap only staff notice; the log names the gap so it gets filled.
 */
export function substituteVars(
  template: string,
  vars: Record<string, string>,
  /** "keep" leaves an unknown placeholder visible — for the editor's preview, where a typo should show. */
  onMissing: "blank" | "keep" = "blank",
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => {
    if (key in vars) return vars[key] ?? "";
    if (onMissing === "keep") return match;
    console.warn(`[template] no value for {{${key}}} — rendered blank`);
    return "";
  });
}

/**
 * The club's email chrome — header bar, white card, footer. Exported and pure
 * so the Send Email hook (`@/lib/auth-email-hook`) can dress a confirmation or
 * a reset link in the same clothes without a second copy of it.
 */
export function emailLayout(body: string, brandColor: string, clubName: string): string {
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
