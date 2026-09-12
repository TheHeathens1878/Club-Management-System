import { Label, Select } from "@club/web";

export const WithLabel = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="role">Role</Label>
    <Select id="role" defaultValue="parent">
      <option value="parent">Parent or guardian</option>
      <option value="player">Adult player</option>
      <option value="coach">Coach</option>
      <option value="committee">Committee</option>
    </Select>
  </div>
);

export const Disabled = () => (
  <div className="space-y-1.5" style={{ maxWidth: 360 }}>
    <Label htmlFor="season">Season</Label>
    <Select id="season" defaultValue="2026" disabled>
      <option value="2026">2026/27</option>
    </Select>
  </div>
);
