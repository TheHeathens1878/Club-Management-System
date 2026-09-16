import { Badge, TBody, TD, TH, THead, TR, Table } from "@club/web";

const TEAMS = [
  ["U9 Mercury", "U9", "Sat 10:00", "12", true],
  ["U11 Venus", "U11", "Sun 10:30", "14", true],
  ["U12 Jupiter", "U12", "Sun 12:00", "16", true],
  ["U14 Saturn", "U14", "Sat 13:30", "18", false],
] as const;

export const Variants = () => (
  <div className="overflow-hidden rounded-xl border bg-card" style={{ maxWidth: 680 }}>
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <tr>
            <TH>Team</TH>
            <TH>Age group</TH>
            <TH>Match day</TH>
            <TH className="text-right">Players</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {TEAMS.map(([name, age, day, players, active]) => (
            <TR key={name} className={active ? undefined : "opacity-60"}>
              <TD className="font-medium">{name}</TD>
              <TD>{age}</TD>
              <TD className="whitespace-nowrap">{day}</TD>
              <TD className="text-right tabular-nums">{players}</TD>
              <TD>
                {active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Archived</Badge>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  </div>
);

// There is no behaviour here on purpose — no sorting, no selection, no empty
// state. A list that wants those wants DataListFrame, which is built on these.
export const InContext = () => (
  <div className="space-y-2" style={{ maxWidth: 520 }}>
    <p className="font-display text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
      Payments against this hire
    </p>
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <Table>
        <THead>
          <tr>
            <TH>Taken</TH>
            <TH>What for</TH>
            <TH className="text-right">Amount</TH>
          </tr>
        </THead>
        <TBody>
          <TR>
            <TD className="whitespace-nowrap">2 Oct</TD>
            <TD>Deposit</TD>
            <TD className="text-right tabular-nums">£100.00</TD>
          </TR>
          <TR>
            <TD className="whitespace-nowrap">14 Oct</TD>
            <TD>Balance</TD>
            <TD className="text-right tabular-nums">£120.00</TD>
          </TR>
          <TR>
            <TD className="whitespace-nowrap">14 Oct</TD>
            <TD>Security deposit</TD>
            <TD className="text-right tabular-nums">£100.00</TD>
          </TR>
        </TBody>
      </Table>
    </div>
  </div>
);
