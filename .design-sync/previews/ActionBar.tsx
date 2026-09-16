import { ActionBar, Button } from "@club/web";
import { CalendarCheck2, CheckCircle2 } from "lucide-react";

// "Nothing moves until you press": the bar every makeover screen opens with.
export const Waiting = () => (
  <ActionBar
    icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
    tone="waiting"
    status="24 sessions are not on the calendar yet"
    detail="Tuesdays and Thursdays from 6 January, skipping Christmas and Half-term."
    action={<Button size="touch">Put them on the calendar</Button>}
  />
);

// The past tense, after the press. The button stays, disabled, with the reason
// on it, so the bar never becomes a place where nothing can happen.
export const Done = () => (
  <ActionBar
    icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
    tone="done"
    status="The calendar matches the timetable"
    detail="Last checked a moment ago · 24 sessions, 3 dates off."
    action={
      <Button size="touch" variant="outline" disabled>
        Nothing to sync
      </Button>
    }
  />
);
