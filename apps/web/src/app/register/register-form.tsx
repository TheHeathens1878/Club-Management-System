"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Loader2, MailCheck, ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { siteConfig } from "@/lib/site-config";

import { registerAccount, type RegisterState } from "./actions";

export function RegisterForm({
  logoUrl,
  logoAlt,
  clubName,
  asReferee = false,
}: {
  logoUrl: string | null;
  logoAlt: string;
  clubName: string;
  /** Arrived from the sign-in page's "Register as a referee" door. */
  asReferee?: boolean;
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerAccount, {});
  const today = new Date().toISOString().slice(0, 10);
  const v = state.values;

  const effectiveLogoUrl = logoUrl || siteConfig.logoUrl;
  const logo = effectiveLogoUrl ? (
    <div className="mx-auto mb-4 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={effectiveLogoUrl} alt={logoAlt} style={{ height: 64, maxWidth: 180, objectFit: "contain" }} />
    </div>
  ) : (
    <div className="mx-auto mb-2 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
      <ShieldCheck className="h-7 w-7" />
    </div>
  );

  // Adam, 2026-08-25: "the check your email for a confirmation link should be
  // more prominent." A green line under a form somebody has stopped reading is
  // the wrong place for the one instruction that decides whether the account
  // ever gets used — so the form gives way to it entirely. There is nothing
  // else to do on this page until they open that email.
  if (state.confirmEmail) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10" />

        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {logo}
            <div className="mx-auto mb-1 inline-flex rounded-full bg-emerald-100 p-3 text-emerald-700">
              <MailCheck className="h-7 w-7" />
            </div>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              Your account is created. Before you can sign in, open the confirmation link we have
              just sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
              We sent it to
              <span className="mt-1 block break-words text-base font-semibold">
                {state.confirmEmail}
              </span>
            </p>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Open the email from {clubName} and click the confirmation link.</li>
              <li>
                2. Nothing there? Look in your spam or junk folder — it usually arrives within a
                minute.
              </li>
              <li>3. Come back and sign in.</li>
            </ol>
            <Link
              href="/login"
              className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Go to sign in
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Wrong address, or the email never arrives?{" "}
              <a href="/contact" className="underline underline-offset-2">
                Tell the club
              </a>{" "}
              and they will sort it out.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10" />

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {logo}
          <CardTitle className="text-2xl">
            {asReferee ? "Register as a referee" : "Create an account"}
          </CardTitle>
          <CardDescription>
            {asReferee ? (
              <>
                Referee for {clubName}. This creates your account and puts your name in front of a
                club administrator — once they approve it, the games that need a referee appear in
                the Referees group for you to claim.
              </>
            ) : (
              <>
                Join {clubName}. Once you are in you can tell us whether you are a player, a parent,
                or a coach — a club administrator approves that part.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            {asReferee && <input type="hidden" name="requested_role" value="referee" />}
            {/* Two fields, not one (Adam, 2026-09-01). A single "Full name"
                had to be split by rule, and the rule takes the last word as the
                surname — which is a guess, and wrong for exactly the people it
                is worst to be wrong about. Asking is cheaper than guessing. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  required
                  autoComplete="given-name"
                  defaultValue={v?.firstName ?? ""}
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  name="last_name"
                  required
                  autoComplete="family-name"
                  defaultValue={v?.lastName ?? ""}
                  placeholder="Smith"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={v?.email ?? ""}
                placeholder="you@example.com"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm_password">Confirm password</Label>
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" name="dob" type="date" required max={today} defaultValue={v?.dob ?? ""} />
              <p className="text-xs text-muted-foreground">
                Required. The club&apos;s safeguarding rules depend on knowing who is an adult and
                who is a young person: players aged 16 or over can sign themselves up, and a
                younger person needs a parent or guardian&apos;s consent on file first. Your date
                of birth is visible only to club administrators.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                defaultValue={v?.phone ?? ""}
                placeholder="07700 900000"
              />
              <p className="text-xs text-muted-foreground">
                Required. A coach calling off a match on a wet Saturday morning needs a number
                that reaches you, and email will not do it in time.
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {asReferee ? "Create account and ask to referee" : "Create account"}
            </Button>
          </form>

          {state.error ? (
            <p className="mt-4 whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.notice ? (
            <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{state.notice}</p>
          ) : null}

          <Link
            href="/login"
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Already have an account? Sign in
          </Link>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <a href="/privacy" className="hover:underline">
              Privacy notice
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
