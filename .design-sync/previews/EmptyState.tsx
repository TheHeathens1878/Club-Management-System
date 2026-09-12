import { EmptyState } from "@club/web";
import { CalendarDays, Inbox } from "lucide-react";

export const WithAction = () => (
  <div style={{ maxWidth: 420 }}>
    <EmptyState
      icon={CalendarDays}
      title="No fixtures yet"
      action={{ href: "/matches/new", label: "Add a fixture" }}
    >
      Fixtures appear here once the league publishes them or you add one.
    </EmptyState>
  </div>
);

export const Plain = () => (
  <div style={{ maxWidth: 420 }}>
    <EmptyState icon={Inbox} title="Nothing waiting for you">
      Registrations you need to review will show up here.
    </EmptyState>
  </div>
);

export const TitleOnly = () => (
  <div style={{ maxWidth: 420 }}>
    <EmptyState title="No messages in this group" />
  </div>
);
