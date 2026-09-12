import { Card, CardContent, CardHeader, CardTitle } from "@club/web";

export const InCard = () => (
  <div style={{ maxWidth: 420 }}>
    <Card>
      <CardHeader>
        <CardTitle>Squad</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          <li>Amelia Hart · GK</li>
          <li>Noah Bright · DEF</li>
          <li>Isla Farrow · MID</li>
        </ul>
      </CardContent>
    </Card>
  </div>
);
