import { TBody, TD, TH, THead, TR, Table } from "@club/web";

// The header is a tinted band with a rule under it, and it can carry a second
// row of column filters — the shape DataListFrame builds on.
export const InTable = () => (
  <div className="overflow-hidden rounded-xl border bg-card" style={{ maxWidth: 560 }}>
    <Table>
      <THead>
        <tr>
          <TH>Player</TH>
          <TH>
            Age band
            <span className="block font-normal normal-case tracking-normal text-muted-foreground/80">
              from date of birth
            </span>
          </TH>
          <TH className="text-right">Subs</TH>
        </tr>
        <tr className="border-t bg-secondary/20">
          <td className="px-4 py-2" />
          <td className="px-4 py-2">
            <select
              aria-label="Filter by age band"
              className="touch h-8 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs"
            >
              <option>All ages</option>
              <option>U11</option>
              <option>U12</option>
            </select>
          </td>
          <td className="px-4 py-2" />
        </tr>
      </THead>
      <TBody>
        <TR>
          <TD className="font-medium">Amelia Hart</TD>
          <TD>U11</TD>
          <TD className="text-right tabular-nums">£45.00</TD>
        </TR>
        <TR>
          <TD className="font-medium">Noah Bright</TD>
          <TD>U12</TD>
          <TD className="text-right tabular-nums">£45.00</TD>
        </TR>
      </TBody>
    </Table>
  </div>
);
