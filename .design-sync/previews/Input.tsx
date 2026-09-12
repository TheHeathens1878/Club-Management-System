import { Input, Label } from "@club/web";

export const WithLabel = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="known-as">Known as</Label>
    <Input id="known-as" placeholder="e.g. Ali" />
  </div>
);

export const Filled = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" defaultValue="sarah.whitfield@example.com" />
  </div>
);

export const Disabled = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="membership">Membership number</Label>
    <Input id="membership" defaultValue="AOM-00412" disabled />
  </div>
);
