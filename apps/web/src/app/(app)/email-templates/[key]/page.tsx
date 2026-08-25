import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { TEMPLATE_DEFINITIONS, type TemplateKey } from "@/lib/template-engine";
import { TemplateEditor } from "./template-editor";

export default async function EditTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  const { key } = await params;
  if (!(key in TEMPLATE_DEFINITIONS)) notFound();

  const templateKey = key as TemplateKey;
  const def = TEMPLATE_DEFINITIONS[templateKey];

  const [admin, settings] = [createAdminClient(), await getSettings()];
  const { data: saved } = await admin
    .from("email_templates")
    .select("subject,body_html")
    .eq("key", templateKey)
    .maybeSingle();

  // Call the default functions with the club name — never pass functions to client components
  const initialSubject = saved?.subject ?? def.defaultSubject(settings.club_name);
  const initialBody = saved?.body_html ?? def.defaultBody(settings.club_name);
  const isCustomised = !!saved;

  return (
    <>
      <PageHeader
        title={def.name}
        subtitle={def.description}
        action={
          <Link
            href="/email-templates"
            className="inline-flex min-h-[44px] items-center text-sm text-primary hover:underline lg:min-h-0"
          >
            ← All templates
          </Link>
        }
      />
      <TemplateEditor
        templateKey={templateKey}
        variables={def.variables}
        initialSubject={initialSubject}
        initialBody={initialBody}
        isCustomised={isCustomised}
      />
    </>
  );
}
