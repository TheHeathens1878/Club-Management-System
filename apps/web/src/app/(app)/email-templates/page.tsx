import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { TEMPLATE_DEFINITIONS, type TemplateKey } from "@/lib/template-engine";
import { resetTemplate } from "./actions";
import { formatDistanceToNow } from "date-fns";
import { Mail, ChevronRight, CheckCircle2, RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function EmailTemplatesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  const admin = createAdminClient();
  const { data: saved } = await admin.from("email_templates").select("key,updated_at,updated_by");
  const savedMap = new Map((saved ?? []).map((r) => [r.key, r]));

  const keys = Object.keys(TEMPLATE_DEFINITIONS) as TemplateKey[];

  return (
    <>
      <PageHeader
        title="Email Templates"
        subtitle="Customise the emails sent automatically by the system."
      />
      <div className="p-6 max-w-2xl space-y-3">
        {keys.map((key) => {
          const def = TEMPLATE_DEFINITIONS[key];
          const custom = savedMap.get(key);

          async function handleReset() {
            "use server";
            await resetTemplate(key);
          }

          return (
            <div key={key} className="flex items-center gap-2 rounded-lg border bg-card hover:bg-muted/40 transition-colors">
              <Link
                href={`/email-templates/${key}`}
                className="flex items-center gap-4 flex-1 p-4 min-w-0"
              >
                <div className="flex-shrink-0 rounded-full bg-primary/10 p-2 text-primary">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{def.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                  {custom ? (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Customised
                      {custom.updated_by && ` · by ${custom.updated_by}`}
                      {custom.updated_at && ` · ${formatDistanceToNow(new Date(custom.updated_at), { addSuffix: true })}`}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Using default</p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </Link>

              {custom && (
                <form action={handleReset} className="pr-3">
                  <button
                    type="submit"
                    title="Reset to default"
                    className={buttonVariants({ variant: "ghost", size: "sm" }) + " gap-1.5 text-muted-foreground hover:text-destructive"}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
