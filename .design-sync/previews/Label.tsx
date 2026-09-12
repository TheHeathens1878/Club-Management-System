import { Input, Label, Select } from "@club/web";

export const WithInput = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="surname">Surname</Label>
    <Input id="surname" placeholder="Whitfield" />
  </div>
);

export const WithSelect = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="age-group">Age group</Label>
    <Select id="age-group" defaultValue="u11">
      <option value="u9">U9</option>
      <option value="u11">U11</option>
      <option value="u12">U12</option>
    </Select>
  </div>
);
