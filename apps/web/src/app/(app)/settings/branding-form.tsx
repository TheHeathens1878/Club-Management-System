"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { saveBrandingSettings } from "./actions";
import { THEMES } from "@/lib/settings";
import type { SiteSettings, ThemeKey } from "@/lib/settings";

export function BrandingForm({ settings }: { settings: SiteSettings }) {
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>((settings.color_theme as ThemeKey) ?? "blue");
  const [logoHeight, setLogoHeight] = useState(Number(settings.logo_height) || 80);
  const [logoMaxWidth, setLogoMaxWidth] = useState(Number(settings.logo_max_width) || 300);
  const [objectFit, setObjectFit] = useState<"contain" | "cover" | "fill">(
    (settings.logo_object_fit as "contain" | "cover" | "fill") ?? "contain"
  );

  async function onSubmit(formData: FormData) {
    setSaving(true);
    setOk(false);
    await saveBrandingSettings(formData);
    setSaving(false);
    setOk(true);
    setTimeout(() => setOk(false), 3000);
  }

  return (
    <form action={onSubmit} className="space-y-8 max-w-xl">
      {/* Logo URL */}
      <div className="space-y-1.5">
        <Label>Logo URL</Label>
        <Input name="logo_url" defaultValue={settings.logo_url} placeholder="https://… or /logo.png" />
        <p className="text-xs text-muted-foreground">
          Upload to Supabase Storage or a CDN and paste the URL. Leave blank to show the club name.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Logo alt text</Label>
        <Input name="logo_alt" defaultValue={settings.logo_alt} placeholder="Club logo" />
      </div>

      {/* Logo display controls */}
      <div className="space-y-4 rounded-lg border p-3 lg:p-4">
        <p className="text-sm font-medium">Logo display</p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Height</label>
            <span className="text-sm font-medium tabular-nums">{logoHeight}px</span>
          </div>
          <input
            type="range" name="logo_height" min={30} max={240} step={4}
            value={logoHeight}
            onChange={(e) => setLogoHeight(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Max width</label>
            <span className="text-sm font-medium tabular-nums">{logoMaxWidth}px</span>
          </div>
          <input
            type="range" name="logo_max_width" min={60} max={600} step={10}
            value={logoMaxWidth}
            onChange={(e) => setLogoMaxWidth(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Fit</label>
          <input type="hidden" name="logo_object_fit" value={objectFit} />
          <div className="flex flex-wrap gap-2">
            {(["contain", "cover", "fill"] as const).map((f) => (
              <button key={f} type="button"
                onClick={() => setObjectFit(f)}
                className={`min-h-[44px] flex-1 rounded-md border px-3 py-1.5 text-sm capitalize transition lg:min-h-0 lg:flex-none
                  ${objectFit === f ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-secondary"}`}>
                {f}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Contain = shrink to fit (no crop) · Cover = fill & crop · Fill = stretch
          </p>
        </div>

        {/* Live preview */}
        {settings.logo_url && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-muted-foreground">Preview</p>
            <div className="rounded-md border bg-card p-3">
              <div
                style={{ height: logoHeight, maxWidth: logoMaxWidth, overflow: "hidden" }}
                className="relative"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.logo_url}
                  alt={settings.logo_alt}
                  style={{ width: "100%", height: "100%", objectFit }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Colour theme */}
      <div className="space-y-3">
        <Label>Colour theme</Label>
        <input type="hidden" name="color_theme" value={theme} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.entries(THEMES) as [ThemeKey, (typeof THEMES)[ThemeKey]][]).map(([key, t]) => {
            const [h, s, l] = t.primary.split(" ");
            const swatch = `hsl(${h},${s},${l})`;
            return (
              <button key={key} type="button" onClick={() => setTheme(key)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-sm transition
                  ${theme === key ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:bg-secondary"}`}>
                <span className="h-6 w-6 shrink-0 rounded-full border shadow-sm" style={{ background: swatch }} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <Button type="submit" disabled={saving} className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
        {ok && <span className="text-sm text-emerald-600">Saved — reload homepage to see changes.</span>}
      </div>
    </form>
  );
}
