/**
 * The status line above the winter-training timetable, in the three states a
 * coach actually meets it in.
 *
 * SyncCard imports `syncBlock` from `../actions` — a `"use server"` module.
 * The bundler swaps that import for tools/render/shims/actions.ts, so the form
 * renders and the button is real, but pressing it does nothing. That is why
 * there is no "just pressed it" case here: `state.synced` only ever arrives
 * back from the server, so the past-tense wording ("8 added · 2 changed") and
 * the spinner on the button cannot be photographed. Both are on the README's
 * "not covered" list.
 */

import { SyncCard } from "@/app/(app)/pitches/training/[id]/sync-card";

import type { Fixture } from "./contract";

const BLOCK_ID = "00000000-0000-4000-8000-000000000001";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl p-4">{children}</div>;
}

const fixture: Fixture = {
  cases: {
    // Something to do: the bar takes the primary border and the button is live.
    waiting: () => (
      <Frame>
        <SyncCard
          blockId={BLOCK_ID}
          counts={{ added: 8, updated: 2, removed: 3, unchanged: 24, cancelled: 1 }}
          dryRunError={null}
          lastSyncedAt="2026-09-10T18:30:00.000Z"
          hasPlan
        />
      </Frame>
    ),

    // Everything already on the calendar: quiet bar, button disabled, and the
    // "last updated" stamp is the only thing worth reading.
    done: () => (
      <Frame>
        <SyncCard
          blockId={BLOCK_ID}
          counts={{ added: 0, updated: 0, removed: 0, unchanged: 24, cancelled: 1 }}
          dryRunError={null}
          lastSyncedAt="2026-09-14T09:05:00.000Z"
          hasPlan
        />
      </Frame>
    ),

    // A brand-new block with no team in any slot: nothing to sync yet, and the
    // bar has to say what to do instead of showing a dead button with no reason.
    nothingToDo: () => (
      <Frame>
        <SyncCard
          blockId={BLOCK_ID}
          counts={{ added: 0, updated: 0, removed: 0, unchanged: 0, cancelled: 0 }}
          dryRunError={null}
          lastSyncedAt={null}
          hasPlan={false}
        />
      </Frame>
    ),
  },
};

export default fixture;
