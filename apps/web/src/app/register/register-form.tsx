"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Loader2, ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { siteConfig } from "@/lib/site-config";

import { registerAccount, type RegisterState } from "./actions";

export function RegisterForm({
  logoUrl,
  logoAlt,
  clubName,
}: {
  logoUrl: string | null;
  logoAlt: string;
  clubName: string;
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

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background to-accent/10" />

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {logo}
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription>
            Join {clubName}. Once you are in you can tell us whether you are a player, a parent, or
            a coach — a club administrator approves that part.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                name="full_name"
                required
                autoComplete="name"
                defaultValue={v?.fullName ?? ""}
                placeholder="Jane Smith"
              />
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
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={v?.phone ?? ""}
                placeholder="07700 900000"
              />
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create account
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
