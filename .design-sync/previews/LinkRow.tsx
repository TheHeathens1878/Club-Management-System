import { Badge, LinkRow } from "@club/web";

export const FixtureRows = () => (
  <div style={{ maxWidth: 560 }}>
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Fixture</th>
          <th className="px-3 py-2">Pitch</th>
          <th className="px-3 py-2"></th>
        </tr>
      </thead>
      <tbody className="divide-y">
        <LinkRow href="/matches/1" className="hover:bg-secondary/50">
          <td className="px-3 py-2">Sun 14 Sep</td>
          <td className="px-3 py-2 font-medium">U11 Venus v Sale United</td>
          <td className="px-3 py-2">Pitch 2</td>
          <td className="px-3 py-2"><Badge variant="success">Confirmed</Badge></td>
        </LinkRow>
        <LinkRow href="/matches/2" className="hover:bg-secondary/50">
          <td className="px-3 py-2">Sun 21 Sep</td>
          <td className="px-3 py-2 font-medium">Altrincham Juniors v U11 Venus</td>
          <td className="px-3 py-2">Away</td>
          <td className="px-3 py-2"><Badge variant="warning">Awaiting kit</Badge></td>
        </LinkRow>
      </tbody>
    </table>
  </div>
);
