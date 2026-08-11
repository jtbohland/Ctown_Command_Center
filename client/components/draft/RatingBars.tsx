import { memo } from "react";
import { cn } from "@/lib/utils";

type RatingVariant = "sos" | "upside" | "bust";

type RatingBarsProps = {
  /** Numeric score 1–5 */
  score: number | null;
  /** Controls fill color logic */
  variant: RatingVariant;
  size?: "sm" | "md";
  /** Override the tooltip label (default derives from variant) */
  label?: string;
};

/**
 * Parse a "3/5" style string into a number (3).
 * Returns null for non-parseable values.
 */
export function parseRatingString(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d+)\s*\/\s*5$/);
  if (match) return parseInt(match[1], 10);
  const num = parseInt(value, 10);
  return num >= 1 && num <= 5 ? num : null;
}

const VARIANT_CONFIG: Record<
  RatingVariant,
  {
    colorFn: (score: number) => string;
    tooltipPrefix: string;
  }
> = {
  sos: {
    // 1–2 = red (tough), 3 = amber (mid), 4–5 = green (easy)
    colorFn: (s) =>
      s <= 2 ? "bg-red-500" : s === 3 ? "bg-amber-500" : "bg-green-500",
    tooltipPrefix: "SOS",
  },
  upside: {
    // Always green — more bars = more upside
    colorFn: (s) => (s >= 4 ? "bg-green-500" : s >= 3 ? "bg-green-500/70" : "bg-green-500/50"),
    tooltipPrefix: "Upside",
  },
  bust: {
    // Always red — more bars = higher bust risk
    colorFn: (s) => (s >= 4 ? "bg-red-500" : s >= 3 ? "bg-red-500/70" : "bg-red-500/50"),
    tooltipPrefix: "Bust",
  },
};

/**
 * Unified 5-bar rating display for SOS, Upside, and Bust.
 * Renders 5 small vertical bars, filled left-to-right based on score.
 */
const RatingBars = memo(function RatingBars({
  score,
  variant,
  size = "sm",
  label,
}: RatingBarsProps) {
  if (score == null)
    return <span className="text-[10px] text-muted-foreground/30">–</span>;

  const barH = size === "sm" ? "h-2.5" : "h-3";
  const barW = size === "sm" ? "w-[3px]" : "w-1";
  const gap = size === "sm" ? "gap-[2px]" : "gap-[3px]";

  const config = VARIANT_CONFIG[variant];
  const filledColor = config.colorFn(score);
  const tooltip = `${label ?? config.tooltipPrefix}: ${score}/5`;

  return (
    <div
      className={cn("inline-flex items-end", gap)}
      title={tooltip}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={cn(
            barW,
            barH,
            "rounded-[1px]",
            i <= score ? filledColor : "bg-muted-foreground/15",
          )}
        />
      ))}
    </div>
  );
});

export default RatingBars;
