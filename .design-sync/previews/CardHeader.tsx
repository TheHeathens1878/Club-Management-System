import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@club/web";

export const InCard = () => (
  <div style={{ maxWidth: 420 }}>
    <Card>
      <CardHeader>
        <CardTitle>Emergency contacts</CardTitle>
        <CardDescription>Who the club calls first on matchday.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Sarah Whitfield · 07700 900123</p>
      </CardContent>
    </Card>
  </div>
);
