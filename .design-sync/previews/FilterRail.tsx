import { Card, CardContent, CardDescription, CardHeader, CardTitle, FilterRail } from "@club/web";

export const DiaryRail = () => (
  <div className="ds-rail" style={{ minHeight: 420, border: "1px solid hsl(30 12% 85%)", borderRadius: 12, overflow: "hidden" }}>
    {/* The frame stands in for a desktop: keep the rail drawn however narrow the card is. */}
    <style>{".ds-rail aside.hidden { display: flex !important; } .ds-rail .lg\\:flex { display: flex !important; }"}</style>
    <FilterRail
      groups={[
        {
          title: "Show me",
          options: [
            { href: "/events", label: "Everything", active: false, swatch: "hsl(20 18% 7%)", count: 27 },
            { href: "/events?type=match", label: "Matches", active: true, swatch: "hsl(12 76% 51%)", count: 8 },
            { href: "/events?type=training", label: "Training", active: false, swatch: "hsl(200 51% 37%)", count: 16 },
            { href: "/events?type=social", label: "Socials", active: false, swatch: "hsl(151 33% 37%)", count: 3 },
          ],
        },
        {
          title: "Whose",
          options: [
            { href: "/events?type=match", label: "Everyone", active: true, count: 8 },
            { href: "/events?type=match&team=u11", label: "U11 Venus", active: false, count: 3 },
            { href: "/events?type=match&team=u12", label: "U12 Jupiter", active: false, count: 5 },
          ],
        },
      ]}
      note={{ title: "1 clash this week", body: "Pitch 1 is double-booked on Saturday at 13:00." }}
      footnote="Fixtures, training and socials share one diary, so a clash cannot hide in another list."
    >
      <div style={{ padding: 20 }}>
        <Card>
          <CardHeader>
            <CardTitle>U11 Venus v Sale United</CardTitle>
            <CardDescription>Sun 14 Sep · 10:30 · Carrington, Pitch 2</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Accept or decline for everyone in your household.</p>
          </CardContent>
        </Card>
      </div>
    </FilterRail>
  </div>
);
