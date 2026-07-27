import * as React from "react";

import { cn } from "@/lib/utils";

type ProgressProps = React.ComponentProps<"div"> & {
  value?: number;
};

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  const safeValue = Math.min(100, Math.max(0, value));

  return (
    <div
      data-slot="progress"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-zinc-200", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-emerald-600 transition-all"
        style={{ transform: `translateX(-${100 - safeValue}%)` }}
      />
    </div>
  );
}
