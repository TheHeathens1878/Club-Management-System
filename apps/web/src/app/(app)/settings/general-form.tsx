"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { saveGeneralSettings } from "./actions";
import type { SiteSettings } from "@/lib/settings";

export function GeneralForm({ settings }: { settings: SiteSettings }) {
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);

  async function onSubmit(formData: FormData) {
    setSaving(true);
    setOk(false);
    await saveGeneralSettings(formData);
    setSaving(false);
    setOk(true);
    setTimeout(() => setOk(false), 3000);
  }

  return (
    <form action={onSubmit} className="space-y-5 max-w-xl">
      <div className="space-y-1.5">
        <Label>Club name</Label>
        <Input name="club_name" defaultValue={settings.club_name} />
      </div>
      <div className="space-y-1.5">
        <Label>Homepage tagline</Label>
        <Input name="club_tagline" defaultValue={settings.club_tagline} />
      </div>
      <div className="space-y-1.5">
        <Label>Homepage description</Label>
        <Textarea name="club_description" defaultValue={settings.club_description} />
      </div>
      <div className="space-y-1.5">
        <Label>Login page subtitle</Label>
        <Input name="login_subtitle" defaultValue={settings.login_subtitle} />
      </div>
      <div className="space-y-1.5">
        <Label>No-email message (shown on login page)</Label>
        <Textarea name="login_no_email" defaultValue={settings.login_no_email} />
      </div>
      <div className="space-y-1.5">
        <Label>Contact email (shown on public booking page)</Label>
        <Input name="contact_email" type="email" defaultValue={settings.contact_email} placeholder="bookings@example.com" />
      </div>

      <div className="space-y-4 rounded-lg border p-3 lg:p-4">
        <p className="text-sm font-medium">Homepage benefit cards</p>
        <p className="text-xs text-muted-foreground">Three cards shown below the hero — describe what makes the club worth joining.</p>
        {([1, 2, 3] as const).map((n) => (
          <div key={n} className="space-y-2 rounded-md bg-secondary/40 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Card {n}</p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Title</label>
              <Input name={`home_benefit_${n}_title`} defaultValue={settings[`home_benefit_${n}_title` as keyof SiteSettings]} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea name={`home_benefit_${n}_desc`} defaultValue={settings[`home_benefit_${n}_desc` as keyof SiteSettings]} rows={2} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <Button type="submit" disabled={saving} className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
        {ok && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </form>
  );
}
