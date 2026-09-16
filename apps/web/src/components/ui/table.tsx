import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A table that looks like the app's tables, and nothing else.
 *
 * Twenty-one screens hand-roll a `<table>` today and each one re-types the
 * same six class strings slightly differently — a header that is
 * `bg-secondary/40` here and `bg-muted` there, cells at `py-2.5` beside cells
 * at `py-3`. These are those strings, named. There is no behaviour here on
 * purpose: no sorting, no selection, no empty state. A list that wants those
 * wants `DataListFrame`, which is built on these.
 *
 * Every part forwards its `className`, so a column that needs to be right
 * aligned or narrow says so at the call site rather than needing a variant.
 *
 * `<Table>` does not scroll on its own. A wide table belongs in a
 * `<div className="overflow-x-auto">`, because only the caller knows whether
 * the page or the table should be the thing that moves sideways.
 */

export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  function Table({ className, ...props }, ref) {
    return <table ref={ref} className={cn("w-full text-left text-sm", className)} {...props} />;
  },
);

export const THead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function THead({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      className={cn("border-b bg-secondary/40 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
});

export const TH = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  function TH({ className, ...props }, ref) {
    return <th ref={ref} className={cn("px-4 py-3 align-top font-medium", className)} {...props} />;
  },
);

export const TBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn("divide-y", className)} {...props} />;
});

export const TR = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  function TR({ className, ...props }, ref) {
    return (
      <tr ref={ref} className={cn("transition-colors hover:bg-secondary/40", className)} {...props} />
    );
  },
);

export const TD = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  function TD({ className, ...props }, ref) {
    return <td ref={ref} className={cn("px-4 py-3 align-top", className)} {...props} />;
  },
);
