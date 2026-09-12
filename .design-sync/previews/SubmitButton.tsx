import { SubmitButton } from "@club/web";

export const InForm = () => (
  <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: 12 }}>
    <SubmitButton>Save changes</SubmitButton>
    <SubmitButton variant="outline" pendingLabel="Sending…">
      Send message
    </SubmitButton>
  </form>
);

export const Small = () => (
  <form onSubmit={(e) => e.preventDefault()}>
    <SubmitButton size="sm">Confirm booking</SubmitButton>
  </form>
);
