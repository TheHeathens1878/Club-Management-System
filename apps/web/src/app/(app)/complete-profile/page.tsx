import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { CompleteProfileForm } from "./form";

/**
 * Shown once, to anybody whose date of birth the club does not hold, until
 * they give it. Middleware sends every other page here while
 * `needs_dob_completion()` is true.
 *
 * Adam, 2026-08-25: "attach all coaches to the teams, even without the DOB.
 * Just make the DOB mandatory for the first time they login." So a coach is
 * put on their team the moment the club records them, and the date is
 * collected here at their first sign-in rather than holding the membership
 * back until somebody chases it.
 */
export default async function CompleteProfilePage() {
  const supabase = await createClient();
  const { data: needs } = await supabase.rpc("needs_dob_completion");
  if (needs !== true) redirect("/");

  return (
    <div className="mx-auto w-full max-w-md space-y-6 p-4 lg:p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">One more thing</h1>
        <p className="text-sm text-muted-foreground">
          The club&apos;s safeguarding rules depend on knowing who is an adult, so before you
          carry on we need your date of birth. Until it is recorded the system has to treat
          you as a young person, which is why some of what you can normally see is not
          showing yet.
        </p>
      </div>
      <CompleteProfileForm />
      <p className="text-xs text-muted-foreground">
        Your date of birth is visible only to club administrators and is used solely to
        apply the club&apos;s safeguarding rules. If you enter it wrongly, ask a club
        administrator to correct it.
      </p>
    </div>
  );
}
