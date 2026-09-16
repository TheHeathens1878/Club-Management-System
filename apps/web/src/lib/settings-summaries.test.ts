import { describe, expect, it } from "vitest";

import type { SiteSettings } from "@/lib/settings";
import { settingsSummaries, type SettingsCounts } from "@/lib/settings-summaries";

// Only the keys the summaries read; the rest of `SiteSettings` is irrelevant
// here and is filled in so the fixture still satisfies the type.
const SETTINGS = {
  club_name: "AOM Sports Club",
  club_tagline: "",
  club_description: "",
  login_subtitle: "",
  login_no_email: "",
  contact_email: "bookings@aomsportsclub.co.uk",
  logo_url: "https://example.invalid/logo.png",
  logo_alt: "Club logo",
  color_theme: "crest",
  logo_height: "80",
  logo_max_width: "300",
  logo_object_fit: "contain",
  home_benefit_1_title: "",
  home_benefit_1_desc: "",
  home_benefit_2_title: "",
  home_benefit_2_desc: "",
  home_benefit_3_title: "",
  home_benefit_3_desc: "",
  deposit_default_pence: "10000",
  deposit_percent: "50",
  room_member_discount_pence: "5000",
  security_deposit_default_pence: "10000",
  deposit_window_days: "7",
  balance_reminder_days: "14",
  auto_cancel_unpaid: "true",
  notify_booking_request: "[]",
  notify_cancellation: "[]",
  notify_auto_cancellation: "[]",
} satisfies SiteSettings;

const COUNTS: SettingsCounts = {
  accounts: 14,
  committee: 3,
  superUsers: 1,
  faqs: 6,
  notifyRecipients: 3,
  customTemplates: 3,
  totalTemplates: 12,
};

function settings(patch: Partial<SiteSettings> = {}): SiteSettings {
  return { ...SETTINGS, ...patch };
}

function counts(patch: Partial<SettingsCounts> = {}): SettingsCounts {
  return { ...COUNTS, ...patch };
}

describe("the closed fold says the value", () => {
  it("names the club and where its booking email lands", () => {
    expect(settingsSummaries(settings(), counts()).general).toBe(
      "AOM Sports Club · bookings@aomsportsclub.co.uk",
    );
  });

  it("states the deposit rule, the security deposit and the chase days", () => {
    expect(settingsSummaries(settings(), counts()).payments).toBe(
      "Deposit: half the total, up to £100.00 · security £100.00 · reminders 14/7/0 days",
    );
  });

  it("spells out a deposit rule that is not half", () => {
    expect(settingsSummaries(settings({ deposit_percent: "25" }), counts()).payments).toContain(
      "Deposit: 25% of the total, up to £100.00",
    );
  });

  it("drops the cap when the club has not set one", () => {
    expect(
      settingsSummaries(settings({ deposit_default_pence: "0" }), counts()).payments,
    ).toBe("Deposit: half the total · security £100.00 · reminders 14/7/0 days");
  });

  it("counts the accounts and the two roles worth knowing", () => {
    expect(settingsSummaries(settings(), counts()).users).toBe(
      "14 accounts · 3 committee · 1 super user",
    );
  });

  it("counts one of anything in the singular", () => {
    expect(
      settingsSummaries(settings(), counts({ accounts: 1, superUsers: 2, faqs: 1 })).users,
    ).toBe("1 account · 3 committee · 2 super users");
    expect(settingsSummaries(settings(), counts({ faqs: 1 })).faqs).toBe(
      "1 question on the public page",
    );
  });

  it("says the logo and the colours", () => {
    expect(settingsSummaries(settings(), counts()).branding).toBe("Logo set · Crest colours");
    expect(settingsSummaries(settings({ color_theme: "red" }), counts()).branding).toBe(
      "Logo set · Crimson colours",
    );
  });

  it("says who is copied in on the club's emails", () => {
    expect(settingsSummaries(settings(), counts()).notifications).toBe("3 staff copied in");
    expect(settingsSummaries(settings(), counts({ notifyRecipients: 1 })).notifications).toBe(
      "1 member of staff copied in",
    );
  });

  it("counts the templates the club has made its own", () => {
    expect(settingsSummaries(settings(), counts()).emailTemplates).toBe("3 of 12 customised");
  });

  it("answers for all seven folds", () => {
    expect(Object.keys(settingsSummaries(settings(), counts())).sort()).toEqual([
      "branding",
      "emailTemplates",
      "faqs",
      "general",
      "notifications",
      "payments",
      "users",
    ]);
  });
});

describe("what an unset value reads as", () => {
  it("says Not set rather than printing a blank", () => {
    const summaries = settingsSummaries(
      settings({ club_name: "", contact_email: "", deposit_percent: "0" }),
      counts(),
    );
    expect(summaries.general).toBe("Not set");
    expect(summaries.payments).toBe("Not set");
  });

  it("keeps whichever half of General it does have", () => {
    expect(settingsSummaries(settings({ contact_email: "  " }), counts()).general).toBe(
      "AOM Sports Club",
    );
  });

  it("says Using defaults for a thing that is quietly working anyway", () => {
    const summaries = settingsSummaries(
      settings({ logo_url: "", color_theme: "" }),
      counts({ customTemplates: 0 }),
    );
    expect(summaries.branding).toBe("Using defaults");
    expect(summaries.emailTemplates).toBe("Using defaults");
  });

  it("says nobody was picked, and who is emailed instead", () => {
    expect(settingsSummaries(settings(), counts({ notifyRecipients: 0 })).notifications).toBe(
      "Nobody picked — super users and committee are copied in",
    );
  });

  it("says None yet for an empty FAQ list and no accounts", () => {
    const summaries = settingsSummaries(settings(), counts({ faqs: 0, accounts: 0 }));
    expect(summaries.faqs).toBe("None yet");
    expect(summaries.users).toBe("No accounts");
  });

  it("falls back to the theme key it was given when it does not know the name", () => {
    expect(settingsSummaries(settings({ color_theme: "teal" }), counts()).branding).toBe(
      "Logo set · teal colours",
    );
  });
});
