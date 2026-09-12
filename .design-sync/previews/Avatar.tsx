import { Avatar } from "@club/web";

const photo =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' fill='#C23D1C'/><circle cx='40' cy='30' r='14' fill='#F7F4F0'/><path d='M12 76c4-18 16-26 28-26s24 8 28 26z' fill='#F7F4F0'/></svg>",
  );

export const Sizes = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <Avatar name="Sarah Whitfield" size="sm" />
    <Avatar name="Sarah Whitfield" size="md" />
    <Avatar name="Sarah Whitfield" size="lg" />
    <Avatar name="Sarah Whitfield" size="xl" />
  </div>
);

export const WithPhoto = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <Avatar name="Noah Bright" photoUrl={photo} size="lg" />
    <Avatar name="Noah Bright" size="lg" />
  </div>
);

export const InRow = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <Avatar name="Isla Farrow" />
    <div>
      <p className="text-sm font-medium leading-tight">Isla Farrow</p>
      <p className="text-xs text-muted-foreground">U12 Jupiter · parent of Amelia</p>
    </div>
  </div>
);
