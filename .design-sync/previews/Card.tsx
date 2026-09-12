import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@club/web";

export const Composed = () => (
  <div style={{ maxWidth: 420 }}>
    <Card>
      <CardHeader>
        <CardTitle>Next fixture</CardTitle>
        <CardDescription>U11 Venus v Sale United · Sunday 10:30, Carrington</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Badge variant="success">Pitch 2 confirmed</Badge>
          <Button size="sm" variant="outline">Availability</Button>
        </div>
      </CardContent>
    </Card>
  </div>
);

export const ContentOnly = () => (
  <div style={{ maxWidth: 420 }}>
    <Card className="p-6">
      <p className="text-sm text-muted-foreground">Subs collected this month</p>
      <p className="font-display text-3xl font-semibold uppercase tracking-wide">£1,240</p>
    </Card>
  </div>
);
