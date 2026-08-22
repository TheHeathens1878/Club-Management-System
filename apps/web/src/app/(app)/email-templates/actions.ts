"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionProfile, isCommittee } from "@/lib/auth";

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) throw new Error("Not authorised");
  return session;
}
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import {
  TEMPLATE_DEFINITIONS,
  substituteVars,
  type TemplateKey,
} from "@/lib/template-engine";
import { getEmailBrandColor, getSettings } from "@/lib/settings";

const DEFAULT_COLOR = "#1249bf";

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

async function emailLayout(body: string, brandColor: string, clubName?: string): Promise<string> {
  const { club_name } = clubName ? { club_name: clubName } : await getSettings();
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

export async function saveTemplate(key: TemplateKey, subject: string, bodyHtml: string) {
  const session = await requireCommittee();
  const admin = createAdminClient();

  if (!TEMPLATE_DEFINITIONS[key]) throw new Error("Invalid template key");

  const { error } = await admin.from("email_templates").upsert({
    key,
    subject: subject.trim(),
    body_html: bodyHtml,
    updated_at: new Date().toISOString(),
    updated_by: session.email,
  }, { onConflict: "key" });

  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "update",
    entity: "email_template",
    entityId: key,
    detail: { name: TEMPLATE_DEFINITIONS[key].name },
  });

  revalidatePath("/email-templates");
  revalidatePath(`/email-templates/${key}`);
}

export async function resetTemplate(key: TemplateKey) {
  const session = await requireCommittee();
  const admin = createAdminClient();

  if (!TEMPLATE_DEFINITIONS[key]) throw new Error("Invalid template key");

  await admin.from("email_templates").delete().eq("key", key);

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "reset",
    entity: "email_template",
    entityId: key,
    detail: { name: TEMPLATE_DEFINITIONS[key].name },
  });

  revalidatePath("/email-templates");
  redirect(`/email-templates/${key}`);
}

export async function previewTemplate(
  key: TemplateKey,
  subject: string,
  bodyHtml: string,
): Promise<string> {
  await requireCommittee();
  const brandColor = await getEmailBrandColor().catch(() => DEFAULT_COLOR);
  const def = TEMPLATE_DEFINITIONS[key];
  if (!def) throw new Error("Invalid template key");

  const settings = await getSettings();
  const exampleVars = Object.fromEntries(def.variables.map((v) => [v.key, v.example]));
  const renderedBody = substituteVars(bodyHtml, exampleVars);
  const styledBody = styleBodyHtml(renderedBody);
  return emailLayout(styledBody, brandColor, settings.club_name);
}
