import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ListOrdered } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { questionFromRow, type RegistrationQuestion } from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/server";

import { FormBuilder } from "./builder";

/**
 * The registration form, editable (Adam, 2026-08-25).
 *
 * Read through the caller's own client: `registration_questions` shows live
 * rows to anyone signed in and archived ones to a club administrator, so what
 * lands here is what the policy handed over. The guard below is the same
 * `is_club_admin()` the table's write policies apply — it stops a coach
 * looking at a builder they could not use, it is not what enforces anything.
 */

export const dynamic = "force-dynamic";

export default async function RegistrationFormBuilderPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!(await isClubAdmin())) redirect("/registrations");

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("registration_questions")
    .select("id,qkey,label,help_text,qtype,options,required,system,locked,position,archived_at")
    .order("position");

  const questions: RegistrationQuestion[] = (rows ?? [])
    .map((row) => questionFromRow(row))
    .filter((question): question is RegistrationQuestion => question !== null);

  return (
    <>
      <PageHeader
        title="Registration form"
        subtitle="What families are asked when they register, and in what order"
        action={
          <Link
            href="/registrations"
            className={
              buttonVariants({ variant: "outline", size: "sm" }) +
              " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
            }
          >
            <ChevronLeft className="h-4 w-4" /> Back to the queue
          </Link>
        }
      />

      <div className="space-y-6 p-4 lg:p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" /> The form
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Drag a question by its handle, or use the arrows, then save the order. Photo
              permissions, data protection and the club&rsquo;s terms are asked on every
              registration and cannot be retired or made optional — the database refuses, not just
              this screen. Questions you add yourself can be retired at any time, and retiring one
              never removes an answer somebody has already given.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            {questions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No questions are set up yet.
              </p>
            ) : (
              <FormBuilder questions={questions} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
