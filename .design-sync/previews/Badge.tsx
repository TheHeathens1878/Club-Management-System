import { Badge } from "@club/web";

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
    <Badge>Pending</Badge>
    <Badge variant="success">Paid</Badge>
    <Badge variant="warning">Awaiting DOB</Badge>
    <Badge variant="muted">Archived</Badge>
    <Badge variant="destructive">Overdue</Badge>
    <Badge variant="outline">Coach</Badge>
  </div>
);

export const InContext = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <span className="text-sm font-medium">U11 Venus · Sunday 10:30</span>
    <Badge variant="success">Confirmed</Badge>
  </div>
);
