import { Label, Textarea } from "@club/web";

export const WithLabel = () => (
  <div className="space-y-1.5" style={{ maxWidth: 420 }}>
    <Label htmlFor="notes">Medical notes</Label>
    <Textarea id="notes" placeholder="Allergies, inhalers, anything a coach should know." />
  </div>
);

export const Filled = () => (
  <div className="space-y-1.5" style={{ maxWidth: 420 }}>
    <Label htmlFor="message">Message to parents</Label>
    <Textarea
      id="message"
      rows={4}
      defaultValue="Training is on this Thursday at 6pm. Please bring a drink and shin pads."
    />
  </div>
);
