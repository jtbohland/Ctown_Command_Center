import { memo, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getTeamEmoji } from "@/lib/draft-constants";

interface Team {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
}

interface Props {
  teams: Team[];
  trajectory: Array<Record<string, number | string>>;
  teamGrades: Array<{
    teamId: number;
    totalValue: number;
    rank: number;
    grade: string;
  }>;
}

// Custom tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  // Sort by value descending
  const sorted = [...payload].sort(
    (a: any, b: any) => (b.value ?? 0) - (a.value ?? 0),
  );

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-2.5 max-w-[220px]">
      <p className="text-xs font-semibold text-foreground mb-1.5">{label}</p>
      <div className="space-y-0.5">
        {sorted.map((entry: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-3 text-[10px]">
            <div className="flex items-center gap-1 truncate">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-mono font-medium text-foreground shrink-0">
              {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TrajectoryChart = memo(function TrajectoryChart({
  teams,
  trajectory,
  teamGrades,
}: Props) {
  const teamLookup = useMemo(() => {
    const map = new Map<number, Team>();
    for (const t of teams) map.set(t.id, t);
    return map;
  }, [teams]);

  // Determine team data keys present in trajectory
  const teamKeys = useMemo(() => {
    if (!trajectory.length) return [];
    return Object.keys(trajectory[0])
      .filter((k) => k.startsWith("team_"))
      .map((k) => {
        const teamId = parseInt(k.replace("team_", ""), 10);
        const team = teamLookup.get(teamId);
        return {
          dataKey: k,
          teamId,
          name: team ? `${getTeamEmoji(team.team_name)} ${team.manager_name}` : k,
          color: team?.color ?? "#888",
        };
      })
      // Sort by current rank (best first)
      .sort((a, b) => {
        const aGrade = teamGrades.find((g) => g.teamId === a.teamId);
        const bGrade = teamGrades.find((g) => g.teamId === b.teamId);
        return (aGrade?.rank ?? 99) - (bGrade?.rank ?? 99);
      });
  }, [trajectory, teamLookup, teamGrades]);

  if (!trajectory.length || teamKeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        Upload Exchange ADP to see team trajectories
      </div>
    );
  }

  // Only show one point? Show a simpler view
  const isSinglePoint = trajectory.length === 1;

  return (
    <div className="w-full">
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        📈 Team Value Trajectory
        {isSinglePoint && (
          <span className="font-normal ml-2">
            (Pre-season only — weekly points appear as actuals are uploaded)
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trajectory} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          {teamKeys.map(({ dataKey, color, name }) => (
            <Line
              key={dataKey}
              type="monotone"
              dataKey={dataKey}
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={trajectory.length <= 6 ? { r: 3, fill: color } : false}
              activeDot={{ r: 4, strokeWidth: 0, fill: color }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export default TrajectoryChart;
