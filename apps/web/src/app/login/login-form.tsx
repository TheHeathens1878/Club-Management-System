"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordPasswordLogin, requestMagicLink, sendPasswordReset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldCheck, Mail, KeyRound, Loader2, ArrowLeft } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { isBookerRole } from "@/lib/types";

type Mode = "magic" | "password";
type View = "login" | "forgot";

export function LoginForm({
  logoUrl,
  logoAlt,
  clubName,
  clubTagline,
}: {
  logoUrl: string | null;
  logoAlt: string;
  clubName: string;
  clubTagline: string;
}) {
  const supabase = createClient();
  const [view, setView] = useState<View>("login");
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "auth") {
      setMessage({ type: "err", text: "Your sign-in link has expired or is invalid. Please request a new one." });
    }
  }, []);

  function goToForgot() { setView("forgot"); setMessage(null); }
  function goToLogin() { setView("login"); setMessage(null); }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await requestMagicLink(email);
    setLoading(false);
    setMessage(error ? { type: "err", text: error } : { type: "ok", text: "Check your email for a sign-in link." });
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setMessage({ type: "err", text: error.message });
      return;
    }
    if (data.user) recordPasswordLogin(data.user.id).catch(() => {});

    // Look up the role before navigating. This round-trip also gives the auth
    // cookie time to settle, so the hard navigation below carries a valid
    // session (otherwise the first request lands back on /login).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user?.id ?? "")
      .maybeSingle();
    const home = isBookerRole(profile?.role) ? "/portal" : "/room-bookings";

    // Honour where they were originally headed, falling back to their home.
    const redirectedFrom = new URLSearchParams(window.location.search).get("redirectedFrom");
    location.href = redirectedFrom || home;
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await sendPasswordReset(email);
    setLoading(false);
    setMessage(error ? { type: "err", text: error } : { type: "ok", text: "Check your email for a password reset link." });
  }

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

      {view === "forgot" ? (
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {logo}
            <CardTitle className="text-2xl">Reset your password</CardTitle>
            <CardDescription>Enter your email and we&apos;ll send you a reset link.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">Email</Label>
                <Input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send reset link
              </Button>
            </form>
            {message && (
              <p className={`mt-4 rounded-md p-3 text-sm ${message.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                {message.text}
              </p>
            )}
            <button type="button" onClick={goToLogin} className="mt-6 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {logo}
            <CardTitle className="text-2xl">{clubName}</CardTitle>
            <CardDescription>{clubTagline}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-secondary p-1">
              <button type="button" onClick={() => { setMode("magic"); setMessage(null); }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mode === "magic" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
                Email link
              </button>
              <button type="button" onClick={() => { setMode("password"); setMessage(null); }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mode === "password" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
                Password
              </button>
            </div>

            <form onSubmit={mode === "magic" ? handleMagicLink : handlePassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </div>
              {mode === "password" && (
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "magic" ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                {mode === "magic" ? "Send sign-in link" : "Sign in"}
              </Button>
            </form>

            {mode === "password" && (
              <div className="mt-3 text-center">
                <button type="button" onClick={goToForgot} className="text-xs text-muted-foreground hover:text-foreground transition">
                  Forgotten your password?
                </button>
              </div>
            )}

            {message && (
              <p className={`mt-4 rounded-md p-3 text-sm ${message.type === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                {message.text}
              </p>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">No account? Contact the club committee to get access.</p>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              <a href="/contact" className="hover:underline">Contact the committee</a>
              {" · "}
              <a href="/privacy" className="hover:underline">Privacy notice</a>
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
