import { Badge, Button, Input, Label, Select, Sheet } from "@club/web";

/**
 * The sheet PORTALS to `document.body` and is `fixed inset-0`, so it does not
 * sit inside the frame below — it paints over the whole card. That is the
 * point of the `Sheet {cardMode:"single", viewport:"420x560"}` override in
 * `.design-sync/config.json`: the card is photographed at phone size, which is
 * the sheet's phone shape (a bottom sheet). The frame is the page it covers,
 * dimmed by the sheet's own scrim.
 */
const Behind = ({ children }: { children?: React.ReactNode }) => (
  <div
    className="ds-behind"
    style={{
      position: "relative",
      minHeight: 520,
      overflow: "hidden",
      border: "1px solid hsl(30 12% 85%)",
      borderRadius: 12,
    }}
  >
    {/* Same trick as previews/FilterRail.tsx: the frame stands in for a real
        screen, so anything hidden until `lg` is drawn however narrow it is. */}
    <style>{".ds-behind .lg\\:flex { display: flex !important; }"}</style>
    <div className="space-y-3 bg-background px-4 py-4">{children}</div>
  </div>
);

// The benchmark shape: a panel you work IN, keyed on the object it is about.
export const Drawer = () => (
  <Behind>
    <p className="text-row font-semibold leading-tight">Winter training block</p>
    <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
      <li className="px-4 py-2.5">Tue 18:00 · U11 Venus · Pitch 2</li>
      <li className="px-4 py-2.5">Tue 19:00 · U12 Jupiter · Pitch 2</li>
      <li className="px-4 py-2.5">Thu 18:00 · U9 Mercury · Pitch 1</li>
    </ul>
    <Sheet
      open
      onClose={() => {}}
      title="Tuesday 18:00 · Pitch 2"
      subtitle="U11 Venus · Carrington 3G"
      headerAction={<Badge variant="success">Booked</Badge>}
      footer={
        <div className="flex gap-2">
          <Button size="touch" className="flex-1">
            Save the slot
          </Button>
          <Button size="touch" variant="outline">
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sheet-team">Team</Label>
          <Select id="sheet-team" defaultValue="venus" className="touch">
            <option value="venus">U11 Venus</option>
            <option value="jupiter">U12 Jupiter</option>
            <option value="mercury">U9 Mercury</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sheet-start">Starts</Label>
          <Input id="sheet-start" type="time" defaultValue="18:00" className="touch" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sheet-coach">Coach</Label>
          <Input id="sheet-coach" defaultValue="Dave Ellery" className="touch" />
        </div>
        <p className="text-xs text-muted-foreground">
          View, edit, clone and remove are modes of this sheet, not four different pages.
        </p>
      </div>
    </Sheet>
  </Behind>
);

// A choice you make and leave: bottom sheet on a phone, centred card at `lg`.
export const Modal = () => (
  <Behind>
    <p className="text-row font-semibold leading-tight">U11 Venus</p>
    <p className="text-sm text-muted-foreground">14 registered players · Sunday league</p>
    <Sheet
      open
      onClose={() => {}}
      side="modal"
      width={420}
      title="Remove Tuesday 18:00?"
      subtitle="Nobody is told; the slot simply leaves the timetable."
      footer={
        <div className="flex gap-2">
          <Button size="touch" variant="destructive" className="flex-1">
            Remove the slot
          </Button>
          <Button size="touch" variant="outline">
            Keep it
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        The pitch booking behind it stays: cancel that separately if the pitch is no longer wanted.
      </p>
    </Sheet>
  </Behind>
);
