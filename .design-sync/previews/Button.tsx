import { Button } from "@club/web";
import { Plus, Send } from "lucide-react";

export const Primary = () => <Button>Save changes</Button>;

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
    <Button>Confirm booking</Button>
    <Button variant="secondary">Save draft</Button>
    <Button variant="outline">Cancel</Button>
    <Button variant="ghost">Back</Button>
    <Button variant="link">View all fixtures</Button>
    <Button variant="destructive">Withdraw</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
    <Button size="sm">Add player</Button>
    <Button>Add player</Button>
    <Button size="lg">Add player</Button>
    <Button size="icon" aria-label="Add player">
      <Plus className="h-4 w-4" />
    </Button>
  </div>
);

export const WithIcon = () => (
  <Button>
    <Send className="h-4 w-4" aria-hidden />
    Send message
  </Button>
);

export const Disabled = () => (
  <div style={{ display: "flex", gap: 12 }}>
    <Button disabled>Confirm booking</Button>
    <Button variant="outline" disabled>
      Cancel
    </Button>
  </div>
);
