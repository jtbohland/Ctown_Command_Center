import { Card, CardContent } from "@/components/ui/card";

export interface RosterMatch {
  matched: number;
  total: number;
  rate: number;
  unmatchedSample: string[];
}

/** Must stay in sync with MIN_ROSTER_MATCH_RATE in SeedActualsFromFile. */
export const MIN_ROSTER_MATCH_RATE = 0.8;

export default function RosterMatchBanner({ match }: { match: RosterMatch }) {
  const pct = Math.round(match.rate * 100);
  const ok = match.rate >= MIN_ROSTER_MATCH_RATE;

  return (
    <Card className={ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/40 bg-red-500/5"}>
      <CardContent className="py-3 px-4 space-y-1">
        <p className={`text-sm font-medium ${ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {ok ? "✓" : "✕"} Roster match: {match.matched} of {match.total} rostered players found in this file ({pct}%)
        </p>
        {!ok && (
          <p className="text-xs text-muted-foreground">
            Below {Math.round(MIN_ROSTER_MATCH_RATE * 100)}% — seeding is blocked so existing data isn't replaced.
            The CSV's player name format may have changed.
          </p>
        )}
        {match.unmatchedSample.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not found: {match.unmatchedSample.join(", ")}
            {match.total - match.matched > match.unmatchedSample.length && "…"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
