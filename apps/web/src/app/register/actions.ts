"use server";

/**
 * Public self-registration (gap 4).
 *
 * The account is a Supabase Auth sign-up and nothing more: `handle_new_user()`
 * reads `full_name`, `dob` and `phone` out of the sign-up metadata, creates the
 * `people` row and a `member` profile, and the SG-10 guard on `profiles` then
 * decides whether that profile may exist at all. So this action authorises
 * nothing — an under-age or unconsented minor is refused by the database, in
 * the middle of the sign-up, and the refusal is what we show.
 *
 * The client is the ordinary anon, cookie-backed server client, which is what
 * makes the returned session stick: email confirmations are off, so `signUp`
 * hands back a session and the person is signed in by the time they land on
 * /welcome.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/utils";

export type RegisterState = {
  error?: string;
  notice?: string;
  /**
   * Set when the account exists but the address has to be confirmed before
   * they can sign in. The form replaces itself with a "check your email"
   * screen (Adam, 2026-08-25: it needs to be impossible to miss), and the
   * address is echoed back so it can say WHICH inbox to look in.
   */
  confirmEmail?: string;
  values?: { fullName: string; email: string; dob: string; phone: string };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function registerAccount(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const fullName = text(formData, "full_name");
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  const dob = text(formData, "dob");
  const phone = text(formData, "phone");
  const values = { fullName, email, dob, phone };

  if (fullName.length < 2) return { error: "Please enter your full name.", values };
  if (!fullName.includes(" ")) {
    return { error: "Please enter both your first name and your surname.", values };
  }
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address.", values };
  if (password.length < MIN_PASSWORD) {
    return { error: `Please choose a password of at least ${MIN_PASSWORD} characters.`, values };
  }
  if (password !== confirm) return { error: "The two passwords do not match.", values };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { error: "Please enter your date of birth.", values };
  }
  const dobDate = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(dobDate.getTime()) || dobDate.getTime() > Date.now()) {
    return { error: "Please enter a valid date of birth.", values };
  }

  const supabase = await createClient();
  // Adam, 2026-08-25: the confirmation link went to the old Vercel host. The
  // project's Site URL is the club's domain now, and the sign-up names the
  // callback itself as well, so the link cannot drift with a dashboard
  // setting. `getSiteUrl()` throws when NEXT_PUBLIC_SITE_URL is unset, which
  // is the right failure — a confirmation link to nowhere is worse.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, dob, phone: phone || null },
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
    },
  });

  if (error) return { error: signUpErrorMessage(error.message), values };

  // Confirmations are off, so a session comes back with the sign-up. If the
  // project is ever switched to confirm-by-email, say so rather than sending
  // them to a page they cannot load.
  if (!data.session) {
    return {
      confirmEmail: email,
      notice:
        "Your account has been created. Check your email for a confirmation link, then sign in.",
    };
  }

  redirect("/welcome");
}

/**
 * SG-10's refusal is the message that matters here, so it is passed through
 * word for word — it names the limb that failed (too young for an account at
 * all, or a minor with no guardian consent) and the person needs to read it.
 * Anything else the auth service says about a database failure gets the same
 * treatment plus the reason it is nearly always the cause.
 */
function signUpErrorMessage(message: string): string {
  if (message.includes("SG-10")) return message;
  if (/already registered|already exists/i.test(message)) {
    return "There is already an account with that email address. Try signing in, or use the 'forgotten your password' link.";
  }
  if (/database error/i.test(message)) {
    return `The club's safeguarding rules refused this sign-up. Under-age applicants cannot hold an account, and a young person needs a parent or guardian's consent recorded by the club first — please contact the club. (${message})`;
  }
  return message;
}
