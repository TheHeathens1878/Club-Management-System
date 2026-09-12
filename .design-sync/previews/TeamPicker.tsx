import { TeamPicker } from "@club/web";

const teams = [
  { id: "u9-mars", name: "U9 Mars", ageGroup: "U9" },
  { id: "u10-saturn", name: "U10 Saturn", ageGroup: "U10" },
  { id: "u11-venus", name: "U11 Venus", ageGroup: "U11" },
  { id: "u12-jupiter", name: "U12 Jupiter", ageGroup: "U12" },
  { id: "u13-neptune", name: "U13 Neptune", ageGroup: "U13" },
  { id: "u15-mercury", name: "U15 Mercury", ageGroup: "U15" },
  { id: "open-sat", name: "Open Age Saturday", ageGroup: null },
  { id: "vets", name: "Veterans", ageGroup: null },
];

export const Single = () => (
  <div style={{ maxWidth: 420 }}>
    <TeamPicker
      id="team"
      name="team_id"
      teams={teams}
      help="Leave it blank if you are not sure and the club will place you."
    />
  </div>
);

export const Multiple = () => (
  <div style={{ maxWidth: 420 }}>
    <TeamPicker
      id="teams"
      name="team_ids"
      teams={teams}
      label="Which teams do you coach?"
      multiple
      required
    />
  </div>
);
