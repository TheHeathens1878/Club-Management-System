"use client";

import { useActionState, useState, useTransition } from "react";
import { Baby, Megaphone, ShieldCheck, Users, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { TEAM_STAFF_REQUEST_ROLES, REQUESTED_ROLE_LABELS } from "@/lib/account-requests";
import { ROLE_VIEW_COOKIE, ROLE_VIEW_LABELS, type RoleView } from "@/lib/role-view";

import { createAccountRequest, setRoleView, type RequestState } from "./actions";

export type TeamOption = { id: string; name: string; ageGroup: string | null };
export type AdminContact = { id: string; name: string; email: string | null };

const TILES: {
  view: RoleView;
  title: string;
  blurb: string;
  Icon: LucideIcon;
}[] = [
  {
    view: "player",
    title: "Player",
    blurb: "I play for one of the club's teams.",
    Icon: Users,
  },
  {
    view: "parent",
    title: "Parent or guardian",
    blurb: "My child plays for the club.",
    Icon: Baby,
  },
  {
    view: "coach",
    title: "Coach or manager",
    blurb: "I coach or manage a team.",
    Icon: Megaphone,
  },
  {
    view: "admin",
    title: "Club admin",
    blurb: "I run part of the club.",
    Icon: ShieldCheck,
  },
];

export function RoleTiles({
  teams,
  initialView,
  admins,
}: {
  teams: TeamOption[];
  initialView: RoleView | null;
  admins: AdminContact[];
}) {
  const [selected, setSelected] = useState<RoleView | null>(initialView);
  const [, startTransition] = useTransition();

  function choose(view: RoleView) {
    setSelected(view);
    // The cookie is what the layout reads; localStorage is kept in step so a
    // client-side reader sees the same answer. Neither grants anything.
    try {
      window.localStorage.setItem(ROLE_VIEW_COOKIE, view);
    } catch {
      // Private mode, or storage disabled. The cookie is the source of truth.
    }
    startTransition(() => {
      void setRoleView(view);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map(({ view, title, blurb, Icon }) => {
          const active = selected === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => choose(view)}
              aria-pressed={active}
              className={
                "rounded-xl border p-4 text-left transition " +
                (active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "bg-card hover:border-primary/40 hover:bg-secondary")
              }
            >
              <Icon className={"h-6 w-6 " + (active ? "text-primary" : "text-muted-foreground")} />
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{blurb}</p>
            </button>
          );
        })}
      </div>

      {selected ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-xs uppercase text-muted-foreground">
              {ROLE_VIEW_LABELS[selected]}
            </p>
            {selected === "player" ? <PlayerPanel teams={teams} /> : null}
            {selected === "parent" ? <ParentPanel /> : null}
            {selected === "coach" ? <CoachPanel teams={teams} /> : null}
            {selected === "admin" ? <AdminPanel admins={admins} /> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Feedback({ state }: { state: RequestState }) {
  return (
    <>
      {state.error ? (
        <p className="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{state.notice}</p>
      ) : null}
    </>
  );
}

function TeamSelect({ teams, id }: { teams: TeamOption[]; id: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Team</Label>
      <Select id={id} name="team_id" required defaultValue="">
        <option value="" disabled>
          Choose a team…
        </option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
            {team.ageGroup ? ` — ${team.ageGroup}` : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PlayerPanel({ teams }: { teams: TeamOption[] }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(createAccountRequest, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requested_role" value="player" />
      <p className="text-sm text-muted-foreground">
        Tell us which team you play for. A club administrator checks it against the squad before
        you are added — nothing is granted by asking.
      </p>
      <TeamSelect teams={teams} id="player-team" />
      <div className="space-y-1.5">
        <Label htmlFor="player-message">Anything we should know? (optional)</Label>
        <Textarea id="player-message" name="message" rows={3} />
      </div>
      <Button type="submit" disabled={pending || teams.length === 0}>
        {pending ? "Sending…" : "Ask to join this team"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function ParentPanel() {
  const [state, action, pending] = useActionState<RequestState, FormData>(createAccountRequest, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="requested_role" value="parent" />
      <p className="text-sm text-muted-foreground">
        Ask to be recorded as a parent or guardian. Children are linked to you by the club, not by
        you — a club administrator makes the link once they have checked it, which is also what
        makes a young person&apos;s consent record possible. Self-service for linking a child is
        coming later.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="parent-message">Which children, and which teams? (optional)</Label>
        <Textarea
          id="parent-message"
          name="message"
          rows={3}
          placeholder="e.g. Sam Smith, Under 12s"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Ask to be recorded as a parent"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function CoachPanel({ teams }: { teams: TeamOption[] }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(createAccountRequest, {});
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tell us the team and what you do there. Being approved for a team with young people in it
        needs an in-date DBS and safeguarding certificate on your record first; if one is missing
        the club administrator will see exactly which, and your request stays waiting until it is
        sorted.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamSelect teams={teams} id="coach-team" />
        <div className="space-y-1.5">
          <Label htmlFor="coach-role">Role</Label>
          <Select id="coach-role" name="requested_role" required defaultValue="coach">
            {TEAM_STAFF_REQUEST_ROLES.map((role) => (
              <option key={role} value={role}>
                {REQUESTED_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="coach-message">Message for the club (optional)</Label>
        <Textarea
          id="coach-message"
          name="message"
          rows={3}
          placeholder="e.g. I have coached the Under 10s since 2023; my DBS is dated March 2025."
        />
      </div>
      <Button type="submit" disabled={pending || teams.length === 0}>
        {pending ? "Sending…" : "Send request"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function AdminPanel({ admins }: { admins: AdminContact[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Administrator access is granted by an existing club administrator — there is no way to ask
        for it here, on purpose. Please speak to one of them.
      </p>
      {admins.length > 0 ? (
        <ul className="text-sm">
          {admins.map((admin) => (
            <li key={admin.id}>
              <span className="font-medium">{admin.name}</span>
              {admin.email ? <span className="text-muted-foreground"> · {admin.email}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Who holds the role is not something your account may read. Ask on the committee&apos;s
          usual channel, or speak to whoever set up your account.
        </p>
      )}
    </div>
  );
}
