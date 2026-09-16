import { Avatar, Button, Popover } from "@club/web";
import { ChevronDown, Users } from "lucide-react";

/**
 * The caller owns the trigger and the `relative` box the two share; the panel
 * hangs off it and leaves the page where it was. The frame stands in for a
 * screen so the panel has somewhere to hang over.
 */
const Screen = ({ children }: { children?: React.ReactNode }) => (
  <div
    className="ds-screen"
    style={{
      position: "relative",
      minHeight: 520,
      overflow: "hidden",
      border: "1px solid hsl(30 12% 85%)",
      borderRadius: 12,
    }}
  >
    {/* As in previews/FilterRail.tsx: the frame IS the screen, so anything the
        app hides until `lg` stays drawn however narrow the card is. */}
    <style>{".ds-screen .lg\\:flex { display: flex !important; }"}</style>
    <div className="space-y-3 bg-background px-4 py-4">{children}</div>
  </div>
);

// A menu over a page you can still read: no scrim.
export const Menu = () => (
  <Screen>
    <p className="text-sm text-muted-foreground">
      Escape and a press anywhere else both close it; a press on the trigger is left alone, so the trigger can
      do its own toggling.
    </p>
    <div className="relative inline-block">
      <Button variant="outline" size="touch" aria-expanded="true">
        <Users className="h-4 w-4" aria-hidden />
        Members
        <ChevronDown className="h-4 w-4" aria-hidden />
      </Button>
      <Popover open onClose={() => {}} label="Members of this conversation" width={280}>
        <p className="border-b px-4 py-2.5 text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          In this conversation
        </p>
        <ul className="divide-y">
          {[
            ["Jane Smith", "Parent · U11 Venus"],
            ["Dave Ellery", "Coach · U11 Venus"],
            ["Priya Nair", "Committee"],
          ].map(([name, role]) => (
            <li key={name} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug">{name}</span>
                <span className="block text-xs text-muted-foreground">{role}</span>
              </span>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  </Screen>
);

// Anchored to the right, with the page dimmed, for a menu that is a decision.
export const RightAnchoredWithScrim = () => (
  <Screen>
    <div className="flex items-start justify-end">
      <div className="relative inline-block">
        <Button variant="outline" size="touch" aria-expanded="true">
          Your hats
          <ChevronDown className="h-4 w-4" aria-hidden />
        </Button>
        <Popover open onClose={() => {}} label="Your hats" anchor="right" width={240} scrim>
          <ul className="divide-y text-sm">
            <li className="px-4 py-2.5 font-medium text-primary">Committee</li>
            <li className="px-4 py-2.5">Coach · U11 Venus</li>
            <li className="px-4 py-2.5">Parent</li>
          </ul>
        </Popover>
      </div>
    </div>
  </Screen>
);
