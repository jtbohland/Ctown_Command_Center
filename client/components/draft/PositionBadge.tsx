import { memo } from "react";
import { cn } from "@/lib/utils";
import { POSITION_BG_CLASSES } from "@/lib/draft-constants";

type PositionBadgeProps = {
  position: string;
  className?: string;
};

const PositionBadge = memo(function PositionBadge({ position, className }: PositionBadgeProps) {
  const posClass = POSITION_BG_CLASSES[position] ?? "bg-muted text-muted-foreground border-border";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0",
        posClass,
        className,
      )}
    >
      {position}
    </span>
  );
});

export default PositionBadge;
