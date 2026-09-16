/**
 * The child's panel, in the two modes that decide its shape (P8.6).
 *
 * `ChildSheet` draws the chrome and the mode strip; the BODY always arrives
 * from the page, already rendered on the server. These cases hand it the real
 * forms — the registration form the club currently asks, and the emergency
 * contacts — because the thing worth photographing is that a whole form fits
 * in a panel and is still thumb-sized on a phone. The forms import the
 * family's `"use server"` actions; the bundler swaps them for the no-op shim,
 * so every control renders and nothing writes.
 *
 * The mode strip is SIX chips, not nine: a parent holds no `people` write
 * policy, so roles, guardianships, identity, money and retiring are not modes
 * here at all. That shorter strip is the safeguarding claim made visible.
 *
 * Each case opens itself on mount by clicking its own trigger, the way
 * `PersonSheet.fixture.tsx` does: the sheet is portalled to <body> and only
 * renders when `open`, so there is nothing to shoot until something opens it.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { ChildSheet } from "@/app/(app)/family/child-sheet";
import {
  CHILD_SHEET_MODES,
  type ChildSheetPanelMode,
} from "@/app/(app)/family/child-sheet-modes";
import { EmergencyContactsForm, RegisterForm } from "@/app/(app)/family/family-forms";
import { Button } from "@/components/ui/button";
import type { RegistrationQuestion } from "@/lib/registration-questions";

import type { Fixture } from "./contract";

const CHILD = "c1";

const MODE_HREFS = Object.fromEntries(
  CHILD_SHEET_MODES.map((mode) => [mode, `/family?child=${CHILD}&sheet=${mode}`]),
) as Record<ChildSheetPanelMode, string>;

function question(
  id: string,
  qkey: string,
  label: string,
  qtype: RegistrationQuestion["qtype"],
  extra: Partial<RegistrationQuestion> = {},
): RegistrationQuestion {
  return {
    id,
    qkey,
    label,
    helpText: null,
    qtype,
    options: [],
    required: true,
    system: true,
    locked: true,
    position: 1,
    archivedAt: null,
    ...extra,
  };
}

const QUESTIONS: RegistrationQuestion[] = [
  question("q1", "medical", "Medical conditions and medication", "long_text", {
    helpText: "Anything a coach would need to know on the touchline.",
    required: false,
  }),
  question("q2", "photo_consents", "Photographs", "photo_consents", { position: 2 }),
  question("q3", "terms", "The club's playing terms", "terms", { position: 3 }),
];

function Opener({
  mode,
  canRegister = true,
  children,
}: {
  mode: ChildSheetPanelMode;
  canRegister?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    trigger.current?.click();
  }, []);

  return (
    <div className="p-4">
      <Button ref={trigger} size="touch" onClick={() => setOpen(true)}>
        Open the child
      </Button>
      <ChildSheet
        childName="Amelia Wareing"
        mode={open ? mode : null}
        closeHref={`/family?child=${CHILD}`}
        modeHrefs={MODE_HREFS}
        canEdit
        canRegister={canRegister}
      >
        {children}
      </ChildSheet>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    // The longest body the panel ever holds: the club's registration form,
    // every question block kept, in a drawer.
    register: () => (
      <Opener mode="register">
        <RegisterForm
          bare
          personId={CHILD}
          personName="Amelia Wareing"
          firstName="Amelia"
          minor
          needsId
          contactsOnRecord={2}
          seasonId="s1"
          seasonName="2026/27"
          teams={[
            { id: "t1", name: "U11 Venus", ageGroup: "U11", gender: "girls" },
            { id: "t2", name: "U12 Mercury", ageGroup: "U12", gender: "mixed" },
          ]}
          questions={QUESTIONS}
          dob="2015-04-12"
          recordedSex="female"
          isAdmin={false}
        />
      </Opener>
    ),

    // The mode the status bar sends a parent to when the club holds nobody to
    // ring — the warning, then the fields that fix it.
    contacts: () => (
      <Opener mode="contacts">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Up to two, kept on Amelia&apos;s record rather than on a registration form, so they
            follow them from season to season.
          </p>
          <EmergencyContactsForm
            childPersonId={CHILD}
            childName="Amelia"
            initial={[]}
            lead={{ name: "Adam Wareing", phone: "07700 900123" }}
          />
        </div>
      </Opener>
    ),
  },
};

export default fixture;
