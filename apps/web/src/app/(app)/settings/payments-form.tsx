"use client";

import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SiteSettings } from "@/lib/settings";
import { savePaymentSettings } from "./actions";

export function PaymentsForm({ settings }: { settings: SiteSettings }) {
  const [ok, setOk] = useState(false);
  const depositPounds = (Number(settings.deposit_default_pence) || 0) / 100;

  async function onSubmit(formData: FormData) {
    setOk(false);
    await savePaymentSettings(formData);
    setOk(true);
  }

  return (
    <form action={onSubmit} className="space-y-6 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="deposit_default_pounds">Default deposit (£)</Label>
        <Input
          id="deposit_default_pounds"
          name="deposit_default_pounds"
          type="number" min="0" step="0.01"
          defaultValue={depositPounds || ""}
          placeholder="100.00"
        />
        <p className="text-xs text-muted-foreground">
          Prefilled when staff confirm a booking. Can be changed per booking.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit_window_days">Deposit due within (days of confirmation)</Label>
        <Input
          id="deposit_window_days"
          name="deposit_window_days"
          type="number" min="0" step="1"
          defaultValue={settings.deposit_window_days || "7"}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="balance_reminder_days">Balance reminder (days before booking)</Label>
        <Input
          id="balance_reminder_days"
          name="balance_reminder_days"
          type="number" min="0" step="1"
          defaultValue={settings.balance_reminder_days || "14"}
        />
        <p className="text-xs text-muted-foreground">
          How many days before the event the balance reminder email is sent.
        </p>
      </div>

      <div className="rounded-md border p-3">
        <label className="flex min-h-[44px] items-start gap-3 text-sm lg:min-h-0 lg:gap-2">
          <input
            type="checkbox"
            name="auto_cancel_unpaid"
            value="1"
            defaultChecked={settings.auto_cancel_unpaid !== "false"}
            className="mt-0.5 shrink-0"
          />
          <span>
            <span className="font-medium">Auto-cancel unpaid deposits</span>
            <span className="block text-xs text-muted-foreground">
              If a confirmed booking&apos;s deposit isn&apos;t paid by the deadline, automatically
              cancel it the next day and email the booker.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <Button type="submit" className="min-h-[44px] w-full lg:min-h-0 lg:w-auto">
          Save payment settings
        </Button>
        {ok && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </form>
  );
}
