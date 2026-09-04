import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Getting started" };

type Step = {
  href: string;
  title: string;
  detail: string;
  done: boolean;
  optional?: boolean;
};

/**
 * The checklist that replaced the numbered menu (2026-09-04 audit): the old
 * "My Profile (1) … Register Players (5)" labels never knew what was done,
 * kept a read-only page as a "step", and taught a different order from the
 * /join wizard. This page READS the state — profile, children, household
 * adults, registrations, membership — ticks what is finished and points at
 * the next thing, which is what a sequence of menu rows never could.
 */
export default async function GettingStartedPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const capabilities = await getCapabilities();

  const supabase = await createClient();
  const [{ data: person }, { data: children }, { data: household }, { data: registrations }, { data: myAccountRow }] =
    await Promise.all([
      capabilities.personId
        ? supabase.from("people").select("dob,phone,email").eq("id", capabilities.personId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc("my_children"),
      supabase.rpc("my_household"),
      supabase.rpc("my_registrations"),
      supabase
        .from("billing_account_people")
        .select("account_id")
        .is("removed_at", null)
        .limit(1)
        .maybeSingle(),
    ]);

  // Enrolled this season? (Same read as /my-payments.)
  let enrolled = false;
  if (myAccountRow) {
    const { data: enrolments } = await supabase
      .from("billing_agreements")
      .select("id,seasons(is_current)")
      .eq("account_id", myAccountRow.account_id)
      .not("season_id", "is", null)
      .in("status", ["active", "paused", "completed"]);
    enrolled = (enrolments ?? []).some((row) => row.seasons?.is_current);
  }

  const childCount = (children ?? []).length;
  const adultCount = (household ?? []).filter((row) => !row.has_login && row.is_adult).length;
  const registrationCount = (registrations ?? []).length;

  // The same order the /join wizard teaches: you, your children, the other
  // adults, then registering, then paying — one canonical sequence.
  const steps: Step[] = [
    {
      href: "/profile",
      title: "Tell us about you",
      detail:
        person?.dob && person?.phone
          ? "Your details are complete."
          : "Your date of birth and a phone number — the club needs both.",
      done: Boolean(person?.dob && person?.phone),
    },
    {
      href: "/family",
      title: "Add your children",
      detail:
        childCount > 0
          ? `${childCount} child${childCount === 1 ? "" : "ren"} connected.`
          : "If children in your household play, connect them to your account.",
      done: childCount > 0,
      optional: true,
    },
    {
      href: "/connected-adults",
      title: "Add household adults",
      detail:
        adultCount > 0
          ? `${adultCount} adult${adultCount === 1 ? "" : "s"} connected.`
          : "A partner on your membership who won't have their own login.",
      done: adultCount > 0,
      optional: true,
    },
    {
      href: "/my-registrations",
      title: "Register whoever plays",
      detail:
        registrationCount > 0
          ? `${registrationCount} registration${registrationCount === 1 ? "" : "s"} in.`
          : "Yourself, a child or a connected adult — this is what puts a player in a squad.",
      done: registrationCount > 0,
    },
    {
      href: "/my-payments",
      title: "Set up membership & payment",
      detail: enrolled
        ? "Your household is enrolled for this season."
        : "One choice — pay up front or monthly — and your membership card follows.",
      done: enrolled,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done && !step.optional) ?? steps.find((step) => !step.done);

  return (
    <>
      <PageHeader
        title="Getting started"
        subtitle={
          doneCount === steps.length
            ? "All set — everything the club needs is done"
            : `${doneCount} of ${steps.length} done${next ? ` — next: ${next.title.toLowerCase()}` : ""}`
        }
      />
      <div className="space-y-3 p-4 lg:p-6">
        {steps.map((step, index) => (
          <Link
            key={step.href}
            href={step.href}
            className={`flex items-center gap-3 rounded-2xl border p-4 transition-colors hover:bg-secondary/40 ${
              step === next ? "border-primary/50 bg-primary/5" : "bg-card"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                step.done
                  ? "bg-emerald-600 text-white"
                  : "border-2 border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {step.done ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{step.title}</span>
                {step.optional && !step.done && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    if it applies
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{step.detail}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ))}

        <p className="pt-2 text-xs text-muted-foreground">
          Everything here can be done in any order, and changed later — this page just keeps the
          score. Your family, profile and registrations are always in the menu on the left.
        </p>
      </div>
    </>
  );
}
