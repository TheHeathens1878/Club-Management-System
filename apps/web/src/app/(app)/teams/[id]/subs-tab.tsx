import { Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataListFrame, type DataColumn, type DataItem } from "@/components/ui/data-list";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

/**
 * The Subs tab: where the squad stands, in three figures and one list
 * (P8.7a).
 *
 * The three counts were three bare `text-2xl` numerals in a wrapped
 * paragraph; they are `StatTile`s now, which is the same three figures said
 * in the shape every other screen in the makeover says them. The roster
 * beneath was written twice — a phone list and a desktop table — which is
 * how two presentations of the same rows drift apart; it is one
 * `DataListFrame` with server-rendered cells.
 *
 * COMMITTEE ONLY. `page.tsx` gates the tab on `committeeTools` and does not
 * make the read for anyone else. The club bills people, not teams, so this is
 * a per-player read joined to the roster; a squad with no subscriptions says
 * so instead of pretending.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type SubsRow = {
  personId: string;
  name: string;
  planName: string | null;
  status: string | null;
  amountDuePence: number | null;
  payerName: string | null;
};

/** Moved out of `page.tsx` whole (P8.7a) — not one query changed. */
export async function loadSubsTab({
  admin,
  teamId,
}: {
  admin: AdminClient;
  teamId: string;
}): Promise<SubsRow[]> {
  const { data: roster } = await admin
    .from("team_memberships")
    .select("person_id,people(first_name,last_name,preferred_name)")
    .eq("team_id", teamId)
    .is("left_at", null)
    .eq("role", "player");
  const playerRows = roster ?? [];
  const playerIdList = Array.from(new Set(playerRows.map((row) => row.person_id)));
  const { data: subs } = playerIdList.length
    ? await admin
        .from("subscriptions")
        .select("person_id,status,amount_due_pence,payer_person_id,created_at,subscription_plans(name)")
        .in("person_id", playerIdList)
        .order("created_at", { ascending: false })
    : { data: [] };
  // Newest subscription per player is the one that speaks for them.
  const latest = new Map<string, NonNullable<typeof subs>[number]>();
  for (const row of subs ?? []) {
    if (!latest.has(row.person_id)) latest.set(row.person_id, row);
  }
  const payerIds = Array.from(
    new Set(
      Array.from(latest.values())
        .map((row) => row.payer_person_id)
        .filter((value): value is string => !!value),
    ),
  );
  const { data: payers } = payerIds.length
    ? await admin.from("people").select("id,first_name,last_name,preferred_name").in("id", payerIds)
    : { data: [] };
  const payerName = new Map(
    (payers ?? []).map((person) => [
      person.id,
      `${person.preferred_name || person.first_name} ${person.last_name}`.trim(),
    ]),
  );
  return playerRows
    .map((row) => {
      const person = row.people;
      const sub = latest.get(row.person_id) ?? null;
      return {
        personId: row.person_id,
        name: person
          ? `${person.preferred_name || person.first_name} ${person.last_name}`.trim()
          : "Club member",
        planName: sub?.subscription_plans?.name ?? null,
        status: sub?.status ?? null,
        amountDuePence: sub?.amount_due_pence ?? null,
        payerName: sub?.payer_person_id ? (payerName.get(sub.payer_person_id) ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

/** The pill that says where one player stands, in one place for both shapes. */
function StatusPill({ row }: { row: SubsRow }) {
  if (row.status === null) return <span className="text-muted-foreground">No subscription</span>;
  if (row.status === "past_due") {
    return (
      <Badge variant="warning">
        {row.amountDuePence !== null ? `${formatCurrency(row.amountDuePence)} owing` : "Owing"}
      </Badge>
    );
  }
  if (row.status === "completed") return <Badge variant="success">Paid</Badge>;
  if (row.status === "active") return <Badge variant="success">On plan</Badge>;
  if (row.status === "cancelled") return <Badge variant="muted">Cancelled</Badge>;
  return <Badge variant="muted">Pending</Badge>;
}

const COLUMNS: DataColumn[] = [
  { key: "player", label: "Player", weight: 3 },
  { key: "plan", label: "Plan", weight: 3, filterKey: "plan", allLabel: "Every plan" },
  { key: "payer", label: "Billed to", weight: 3 },
  { key: "status", label: "Status", weight: 2, filterKey: "status", allLabel: "Every status" },
];

export function SubsTab({ rows }: { rows: SubsRow[] }) {
  const covered = rows.filter(
    (row) => row.status === "active" || row.status === "completed",
  ).length;
  const owing = rows.filter((row) => row.status === "past_due");
  const none = rows.filter((row) => row.status === null).length;
  const owedPence = owing.reduce((sum, row) => sum + (row.amountDuePence ?? 0), 0);

  const items: DataItem[] = rows.map((row) => ({
    key: row.personId,
    haystack: `${row.name} ${row.planName ?? ""} ${row.payerName ?? ""}`.toLocaleLowerCase("en-GB"),
    facets: {
      plan: row.planName ?? "No plan",
      status:
        row.status === null
          ? "No subscription"
          : row.status === "past_due"
            ? "Owing"
            : row.status === "completed"
              ? "Paid"
              : row.status === "active"
                ? "On plan"
                : row.status === "cancelled"
                  ? "Cancelled"
                  : "Pending",
    },
    cells: (
      <>
        <td className="px-4 py-2.5 font-medium">{row.name}</td>
        <td className="px-4 py-2.5 text-muted-foreground">{row.planName ?? "—"}</td>
        <td className="px-4 py-2.5 text-muted-foreground">{row.payerName ?? "—"}</td>
        <td className="px-4 py-2.5">
          <StatusPill row={row} />
        </td>
      </>
    ),
    card: (
      <span className="flex items-start justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{row.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {row.planName ?? "No plan"}
            {row.payerName ? ` · billed to ${row.payerName}` : ""}
          </span>
        </span>
        <span className="flex-none text-xs">
          <StatusPill row={row} />
        </span>
      </span>
    ),
  }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each player&apos;s latest subscription. The club bills the payer — usually a parent — so
        &ldquo;billed to&rdquo; names them. Payments themselves are handled on the money screens;
        this is the team&apos;s view of where everyone stands.
      </p>

      <StatRow className="lg:grid-cols-3">
        <StatTile
          label="Covered"
          value={covered}
          hint={`of ${rows.length} ${rows.length === 1 ? "player" : "players"}`}
          tone={rows.length > 0 && covered === rows.length ? "success" : "default"}
          icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
        />
        <StatTile
          label="Owing"
          value={owing.length}
          hint={owedPence > 0 ? `${formatCurrency(owedPence)} outstanding` : "Nothing past due"}
          tone={owing.length > 0 ? "warning" : "default"}
        />
        <StatTile label="No subscription yet" value={none} hint="Never been put on a plan" />
      </StatRow>

      <DataListFrame
        items={items}
        columns={COLUMNS}
        search={{ param: "q", placeholder: "Search the roster", initial: "" }}
        empty={{
          icon: <Wallet className="h-5 w-5" aria-hidden />,
          title: "No players on the roster yet.",
          body: "Subs follow the squad — add somebody on the Squad tab and they appear here.",
        }}
        noMatch="No player matches that search or those filters."
      />
    </div>
  );
}
