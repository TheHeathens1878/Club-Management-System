import { Button, PageHeader } from "@club/web";
import { Plus } from "lucide-react";

export const Default = () => (
  <PageHeader title="Teams" subtitle="Every team the club runs this season, by age group." />
);

export const WithBackAndAction = () => (
  <PageHeader
    title="U11 Venus"
    subtitle="Sunday league · 14 registered players"
    back={{ href: "/my-teams", label: "Teams" }}
    action={
      <Button size="sm">
        <Plus className="h-4 w-4" aria-hidden />
        Add player
      </Button>
    }
  />
);

export const Compact = () => (
  <div style={{ maxWidth: 390 }}>
    <PageHeader
      title="U12 Jupiter parents"
      subtitle="Group conversation"
      compact
      back={{ href: "/messages", label: "Messages" }}
      action={<Button size="sm" variant="outline">Info</Button>}
    />
  </div>
);
