import * as React from "react";

import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

/**
 * The status bar: an icon tile, one sentence of what this object needs, a
 * line of detail under it, and the ONE button that does it. Lifted from the
 * training block page's calendar bar (P8.0d), which is the shape the whole
 * makeover copies — "what is the state of this thing, and what is the single
 * next thing to do about it", answered above the fold on every screen.
 *
 * `as="form"` makes the bar itself the form, so the button is a plain
 * submit and `useActionState` drives the whole bar: pass the dispatcher as
 * `formAction` (the native attribute name `action` is taken by the button
 * slot). Hidden inputs can ride along inside `action` — they draw nothing.
 *
 * `tone` is what the sentence means, not decoration: `waiting` is "nothing
 * moves until you press", `done` is the past tense after a press, `error`
 * is what went wrong. `children`, when given, are drawn beneath the row
 * inside the same surface — the footnote and the named warnings a bulk
 * action comes back with.
 */
export type ActionBarTone = "idle" | "pending" | "waiting" | "done" | "error";

const TONE: Record<ActionBarTone, { edge: string; ink: string }> = {
  idle: { edge: "", ink: "" },
  pending: { edge: "border-primary/40", ink: "text-primary" },
  waiting: { edge: "border-primary/40", ink: "text-primary" },
  done: { edge: "", ink: "text-success" },
  error: { edge: "border-destructive/30", ink: "text-destructive" },
};

type Shared = {
  /** A rendered icon, e.g. `<CalendarCheck2 className="h-4 w-4" aria-hidden />`. */
  icon?: React.ReactNode;
  /** The one sentence. */
  status: React.ReactNode;
  detail?: React.ReactNode;
  tone?: ActionBarTone;
  /** The control this bar exists for — usually a single Button. */
  action: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

type DivProps = Shared & {
  as?: "div";
} & Omit<React.HTMLAttributes<HTMLDivElement>, keyof Shared>;

type FormProps = Shared & {
  as: "form";
  /** The form's own `action` — a server action or a `useActionState` dispatcher. */
  formAction?: React.ComponentPropsWithoutRef<"form">["action"];
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, keyof Shared | "action">;

export type ActionBarProps = DivProps | FormProps;

export function ActionBar(props: ActionBarProps) {
  const { icon, status, detail, tone = "idle", action, children, className } = props;
  const look = TONE[tone];

  const row = (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {icon ? <IconTile icon={icon} size="md" /> : null}
        <div className="min-w-0 flex-1 basis-56">
          <p className={cn("text-row font-semibold leading-tight", look.ink)}>{status}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </>
  );

  const shell = cn("rounded-xl border bg-card px-4 py-3 shadow-sm lg:px-5", look.edge, className);

  if (props.as === "form") {
    const { as: _as, icon: _i, status: _s, detail: _d, tone: _t, action: _a, children: _c, className: _cn, formAction, ...rest } = props;
    return (
      <form action={formAction} className={cn(shell, "space-y-3")} {...rest}>
        {row}
      </form>
    );
  }

  const { as: _as, icon: _i, status: _s, detail: _d, tone: _t, action: _a, children: _c, className: _cn, ...rest } = props;
  return (
    <div className={cn(shell, children ? "space-y-3" : "")} {...rest}>
      {row}
    </div>
  );
}
