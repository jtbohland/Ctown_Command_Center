import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface ConfidenceTooltipProps {
  confidence: string | null | undefined;
  reasons: string[] | null | undefined;
  /** Extra classes applied to the Badge pill */
  className?: string;
}

const CONF_STYLES: Record<string, { colors: string; icon: string; label: string }> = {
  high: {
    colors: "border-emerald-500/30 text-emerald-400",
    icon: "✓",
    label: "High",
  },
  medium: {
    colors: "border-amber-500/30 text-amber-400",
    icon: "~",
    label: "Medium",
  },
  low: {
    colors: "border-red-500/30 text-red-400",
    icon: "?",
    label: "Low",
  },
};

/**
 * A confidence pill (Badge) wrapped in a Tooltip that explains why
 * a trade received its confidence level. Renders in every verdict surface.
 */
export function ConfidenceTooltip({ confidence, reasons, className }: ConfidenceTooltipProps) {
  if (!confidence) {
    return <span className="text-[9px] text-muted-foreground/50">—</span>;
  }

  const style = CONF_STYLES[confidence] ?? CONF_STYLES.medium;
  const reasonList = reasons?.length ? reasons : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-[8px] px-1 py-0 cursor-help ${style.colors} ${className ?? ""}`}
        >
          {style.icon} {confidence}
        </Badge>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={4}
        className="max-w-[260px] bg-zinc-900 border border-zinc-700 text-zinc-100 p-2.5 text-left"
      >
        <p className={`text-[11px] font-semibold mb-1 ${style.colors.split(" ").pop()}`}>
          Confidence: {style.label}
        </p>
        <p className="text-[10px] text-zinc-400 leading-snug mb-1.5">
          Based on the quality and completeness of this trade's valuation inputs.
        </p>
        {reasonList && (
          <>
            <p className="text-[10px] text-zinc-300 font-medium mb-0.5">Reasons:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {reasonList.map((r, i) => (
                <li key={i} className="text-[9px] text-zinc-400 leading-snug">
                  {r}
                </li>
              ))}
            </ul>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
