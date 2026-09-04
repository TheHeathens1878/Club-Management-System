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

export const metadata = { title: "Email Templates" };

export default async function EmailTemplatesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/lobby");

  const admin = createAdminClient();
  const { data: saved } = await admin.from("email_templates").select("key,updated_at,updated_by");
  const savedMap = new Map((saved ?? []).map((r) => [r.key, r]));

  const keys = Object.keys(TEMPLATE_DEFINITIONS) as TemplateKey[];

  return (
    <>
      <PageHeader
        title="Email Templates"
        subtitle="Customise the emails sent automatically by the system."
        back={{ href: "/settings?tab=email-templates", label: "Settings" }}
      />
      <div className="p-4 max-w-2xl space-y-3 lg:p-6">
        {keys.map((key) => {
          const def = TEMPLATE_DEFINITIONS[key];
          const custom = savedMap.get(key);

          async function handleReset() {
            "use server";
            await resetTemplate(key);
          }

          return (
            // Below lg the row is a card: the link stacked over its own Reset
            // button, so neither has to share a phone-width line.
            <div key={key} className="flex flex-col rounded-lg border bg-card hover:bg-muted/40 transition-colors lg:flex-row lg:items-center lg:gap-2">
              <Link
                href={`/email-templates/${key}`}
                className="flex min-h-[44px] items-center gap-4 flex-1 p-4 min-w-0"
              >
                <div className="flex-shrink-0 rounded-full bg-primary/10 p-2 text-primary">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{def.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                  {custom ? (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      <span className="min-w-0">
                        Customised
                        {custom.updated_by && ` · by ${custom.updated_by}`}
                        {custom.updated_at && ` · ${formatDistanceToNow(new Date(custom.updated_at), { addSuffix: true })}`}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Using default</p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </Link>

              {custom && (
                <form action={handleReset} className="border-t px-4 py-3 lg:border-t-0 lg:px-0 lg:py-0 lg:pr-3">
                  <button
                    type="submit"
                    title="Reset to default"
                    className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-full min-h-[44px] gap-1.5 text-muted-foreground hover:text-destructive lg:w-auto lg:min-h-0"}
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
