import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DraftCapitalRow {
  id: number;
  year: number;
  round: number;
  original_team_id: number;
  current_team_id: number;
  original_team_name: string;
  current_team_name: string;
}

interface Team {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
}

interface Props {
  draftCapital: DraftCapitalRow[];
  teams: Team[];
}

export default function DraftCapitalView({ draftCapital, teams }: Props) {
  const [yearFilter, setYearFilter] = useState<string>("all");

  const years = useMemo(() => {
    const s = new Set(draftCapital.map((dc) => dc.year));
    return Array.from(s).sort();
  }, [draftCapital]);

  const filtered = useMemo(() => {
    if (yearFilter === "all") return draftCapital;
    return draftCapital.filter((dc) => dc.year === Number(yearFilter));
  }, [draftCapital, yearFilter]);

  // Group by team → what picks they own
  const byTeam = useMemo(() => {
    const map = new Map<number, { team: Team; picks: DraftCapitalRow[] }>();
    for (const team of teams) {
      map.set(team.id, { team, picks: [] });
    }
    for (const dc of filtered) {
      const entry = map.get(dc.current_team_id);
      if (entry) {
        entry.picks.push(dc);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.team.id - b.team.id);
  }, [filtered, teams]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">🗺️ Draft Capital Map</h3>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Team Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {byTeam.map(({ team, picks }) => {
          const ownPicks = picks.filter((p) => p.original_team_id === team.id);
          const acquiredPicks = picks.filter((p) => p.original_team_id !== team.id);
          const tradedAway = filtered.filter(
            (dc) => dc.original_team_id === team.id && dc.current_team_id !== team.id
          );

          return (
            <div
              key={team.id}
              className="border border-border rounded-lg p-3"
              style={{ borderTopColor: team.color, borderTopWidth: 3 }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold">{team.team_name}</span>
                <span className="text-xs text-muted-foreground">{team.manager_name}</span>
              </div>

              {/* Own picks */}
              {ownPicks.length > 0 && (
                <div className="mb-1">
                  <div className="text-[10px] text-muted-foreground font-medium mb-0.5">Own Picks</div>
                  <div className="flex flex-wrap gap-1">
                    {ownPicks.map((p) => (
                      <Badge key={p.id} variant="secondary" className="text-[10px] px-1.5">
                        {p.year} Rd{p.round}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Acquired picks */}
              {acquiredPicks.length > 0 && (
                <div className="mb-1">
                  <div className="text-[10px] text-emerald-400 font-medium mb-0.5">+ Acquired</div>
                  <div className="flex flex-wrap gap-1">
                    {acquiredPicks.map((p) => (
                      <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 border-emerald-500/30 text-emerald-400">
                        {p.year} Rd{p.round} (from {p.original_team_name.split(" ")[0]})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Traded away */}
              {tradedAway.length > 0 && (
                <div>
                  <div className="text-[10px] text-red-400 font-medium mb-0.5">- Traded Away</div>
                  <div className="flex flex-wrap gap-1">
                    {tradedAway.map((p) => (
                      <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 border-red-500/30 text-red-400 line-through">
                        {p.year} Rd{p.round} → {p.current_team_name.split(" ")[0]}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {picks.length === 0 && tradedAway.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No picks in this range</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
