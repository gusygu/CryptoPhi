"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", decorative = true, ...props }, ref) => {
    const role = decorative ? "presentation" : "separator";
    const ariaOrientation = decorative ? undefined : orientation;
    return (
      <div
        ref={ref}
        role={role}
        aria-orientation={ariaOrientation}
        className={cn(
          "shrink-0 bg-border",
          orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
          className,
        )}
        {...props}
      />
    );
  },
);
Separator.displayName = "Separator";

export { Separator }
