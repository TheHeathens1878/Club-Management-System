/**
 * The team's Settings tab, folded (P8.7a).
 *
 * The thing worth photographing is the CLOSED state: six 52px rows, each
 * saying what it is set to rather than what it is called, plus the signpost
 * that tells a coach where the allocation settings went. The whole tab has to
 * fit one screen at 390 — that is the promise the fold makes, and a summary
 * that wraps to three lines breaks it, so the long-summary case is here too.
 *
 * `SettingsTab` is a plain server component: it draws, and its loader reads.
 * Nothing here needs a Supabase client.
 *
 * KNOWN, AND NOT THIS SCREEN'S TO FIX: the harness measures tap targets
 * inside a CLOSED fold as well as an open one, and the five panels the folds
 * hold draw `Input` (40px) and `Button size="sm"` (36px). That is a debt of
 * the shared controls, exactly as `SettingsFolds.fixture.tsx` records for
 * P8.10, and P8.7 leaves the panel bodies as they are. Nothing a reader can
 * actually press on this tab — the six summaries and the signpost — is under
 * 44px.
 */

import {
  SettingsTab,
  type SettingsTabData,
  type SettingsTeam,
} from "@/app/(app)/teams/[id]/settings-tab";
import type { FullTimeLinkView } from "@/app/(app)/teams/[id]/fulltime-panel";

import type { Fixture } from "./contract";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl p-4">{children}</div>;
}

const team: SettingsTeam = {
  id: "t1",
  name: "U14 Mavericks",
  age_group: "U14",
  active: true,
  playing_format: null,
  home_resource_id: "r1",
  home_kickoff_time: "10:30:00",
  central_venue_name: null,
  league: "Timperley & District",
  division: "Division 2",
  match_halves: 2,
  half_length_minutes: 35,
  half_time_minutes: 10,
  default_pre_buffer_minutes: 15,
  default_post_buffer_minutes: 15,
  default_training_day: 2,
};

const link: FullTimeLinkView = {
  source_url: "https://fulltime.thefa.com/fixtures.html",
  widget_code: "<div id='lrep123'></div>",
  league_id: "123",
  ft_season_id: "2026",
  division_id: "77",
  fixture_group_key: "g1",
  ft_team_id: "9911",
  ft_team_name: "Ashton On Mersey FC U14 Mavericks",
  enabled: true,
  last_import_at: "2026-09-16T02:10:00.000Z",
  last_import_status: "ok",
  last_import_count: 12,
  last_error: null,
};

const data: SettingsTabData = {
  clubSeasons: [
    { id: "s1", name: "2026/27", is_current: true },
    { id: "s0", name: "2025/26", is_current: false },
  ],
  currentSeason: { id: "s1", name: "2026/27", is_current: true },
  defaultFtName: "Ashton On Mersey FC U14 Mavericks",
  runs: [
    {
      id: 1,
      trigger: "nightly",
      status: "ok",
      inserted: 0,
      updated: 8,
      unchanged: 4,
      retired: 0,
      keptBack: 0,
      error: null,
      source_url: "https://fulltime.thefa.com/fixtures.html",
      created_at: "2026-08-02T02:10:00.000Z",
    },
  ],
  homeFixtures: { total: 14, unplaced: 9 },
};

const pitches = [
  { id: "r1", name: "Banky Lane 1" },
  { id: "r2", name: "Banky Lane 2" },
];

const fixture: Fixture = {
  cases: {
    /** The whole tab as an administrator finds it: six rows, all shut. */
    admin: () => (
      <Frame>
        <SettingsTab
          team={team}
          data={data}
          link={link}
          pitches={pitches}
          homePitchName="Banky Lane 1"
          allocationTools
          committeeTools
          clubAdmin
        />
      </Frame>
    ),

    /**
     * A coach: the signpost is above the folds, Training, Manual import,
     * Team status and Allocate are not rendered at all, and Match day is
     * there to read rather than to change.
     */
    coach: () => (
      <Frame>
        <SettingsTab
          team={team}
          data={data}
          link={link}
          pitches={pitches}
          homePitchName="Banky Lane 1"
          allocationTools={false}
          committeeTools={false}
          clubAdmin={false}
        />
      </Frame>
    ),

    /** Nothing set, and a central-venue team: every summary earns its row. */
    unset: () => (
      <Frame>
        <SettingsTab
          team={{
            ...team,
            active: false,
            home_resource_id: null,
            home_kickoff_time: null,
            central_venue_name: "Platt Lane Sports Complex",
            default_training_day: null,
            match_halves: 2,
            half_length_minutes: null,
          }}
          data={{ ...data, runs: [], homeFixtures: { total: 0, unplaced: 0 } }}
          link={null}
          pitches={pitches}
          homePitchName={null}
          allocationTools
          committeeTools
          clubAdmin
        />
      </Frame>
    ),
  },
};

export default fixture;
