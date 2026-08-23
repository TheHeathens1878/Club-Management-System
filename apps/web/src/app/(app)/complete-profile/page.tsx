import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { CompleteProfileForm } from "./form";

/**
 * Shown once, to accounts imported from the pitch-booking app, until they
 * have told us their date of birth. Middleware sends every other page here
 * while `needs_dob_completion()` is true.
 */
export default async function CompleteProfilePage() {
  const supabase = await createClient();
  const { data: needs } = await supabase.rpc("needs_dob_completion");
  if (needs !== true) redirect("/");

  return (
    <div className="mx-auto max-w-md space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">One more thing</h1>
        <p className="text-sm text-muted-foreground">
          Your account has been moved over from the pitch-booking app. The club&apos;s
          safeguarding rules depend on knowing who is an adult, so before you carry on we
          need your date of birth. Until it is recorded the system has to treat you as a
          young person — which is why your teams and conversations are not showing yet.
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
