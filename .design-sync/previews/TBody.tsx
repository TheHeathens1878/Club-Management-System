import { TBody, TD, TH, THead, TR, Table } from "@club/web";

// The body divides its rows itself, so no row needs its own border.
export const InTable = () => (
  <div className="overflow-hidden rounded-xl border bg-card" style={{ maxWidth: 560 }}>
    <Table>
      <THead>
        <tr>
          <TH>Session</TH>
          <TH>Pitch</TH>
          <TH className="text-right">In</TH>
        </tr>
      </THead>
      <TBody>
        {[
          ["Tue 18:00 · U9 Mercury", "Pitch 1", "9"],
          ["Tue 19:00 · U11 Venus", "Pitch 2", "12"],
          ["Thu 18:00 · U12 Jupiter", "Pitch 2", "14"],
          ["Thu 19:00 · Adults", "Pitch 1", "8"],
        ].map(([session, pitch, replies]) => (
          <TR key={session}>
            <TD className="font-medium">{session}</TD>
            <TD>{pitch}</TD>
            <TD className="text-right tabular-nums">{replies}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  </div>
);
