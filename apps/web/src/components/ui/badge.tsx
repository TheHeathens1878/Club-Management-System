import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        // Tokens, not `emerald-100`/`amber-100`: the literals were fixed sRGB,
        // so a "Confirmed" badge dropped into the dark crest rail arrived as a
        // white chip. The variant names are unchanged, so every existing call
        // site gets the fix without moving.
        success: "border-transparent bg-success-tint text-success",
        warning: "border-transparent bg-warning-tint text-warning",
        muted: "border-transparent bg-muted text-muted-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
