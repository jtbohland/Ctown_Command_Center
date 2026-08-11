import { memo } from "react";
import { getPlayerVegas, getVegasFraction, getVegasColor, getVegasTextColor } from "@/lib/draft-constants.js";

type VegasBarProps = {
  nflTeam: string;
};

/**
 * Horizontal bar + number showing Vegas implied team points.
 * Green (25+) = elite offense, Amber (22-25) = average, Red (<22) = weak.
 */
function VegasBarInner({ nflTeam }: VegasBarProps) {
  const pts = getPlayerVegas(nflTeam);
  if (pts == null) return <span className="text-muted-foreground/40 text-[10px]">–</span>;

  const fraction = getVegasFraction(pts);
  const barColor = getVegasColor(pts);
  const textColor = getVegasTextColor(pts);

  return (
    <div className="flex items-center gap-1.5" title={`Vegas Implied: ${pts.toFixed(1)} PPG`}>
      {/* Bar */}
      <div className="w-8 h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      {/* Number */}
      <span className={`text-[10px] font-mono font-medium ${textColor} leading-none`}>
        {pts.toFixed(1)}
      </span>
    </div>
  );
}

export const VegasBar = memo(VegasBarInner);
