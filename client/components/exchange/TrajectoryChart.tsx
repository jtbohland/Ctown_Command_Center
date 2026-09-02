import { memo, useMemo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

// ─── Shared tooltip (works for both bar + line) ─────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

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
                style={{ backgroundColor: entry.color ?? entry.payload?.color }}
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

// ─── Bar tooltip for preseason ──────────────────────────────

function BarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-2.5 max-w-[200px]">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
        <span className="text-xs font-semibold text-foreground">{d.fullLabel ?? d.label}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px]">
        <span className="text-muted-foreground">Score</span>
        <span className="font-mono font-medium text-foreground">{d.value.toFixed(1)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px]">
        <span className="text-muted-foreground">Grade</span>
        <span className="font-mono font-medium text-foreground">{d.grade}</span>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────

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

  // Team keys sorted by rank (best first)
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
      .sort((a, b) => {
        const aGrade = teamGrades.find((g) => g.teamId === a.teamId);
        const bGrade = teamGrades.find((g) => g.teamId === b.teamId);
        return (aGrade?.rank ?? 99) - (bGrade?.rank ?? 99);
      });
  }, [trajectory, teamLookup, teamGrades]);

  // Reshape preseason data into bar-friendly format: one row per team
  const barData = useMemo(() => {
    if (trajectory.length !== 1 || !teamKeys.length) return [];
    const point = trajectory[0];
    return teamKeys.map((tk) => {
      const team = teamLookup.get(tk.teamId);
      const grade = teamGrades.find((g) => g.teamId === tk.teamId);
      return {
        label: team?.manager_name ?? tk.name,
        fullLabel: tk.name,
        value: (point[tk.dataKey] as number) ?? 0,
        color: tk.color,
        grade: grade?.grade ?? "—",
        rank: grade?.rank ?? 99,
      };
    });
  }, [trajectory, teamKeys, teamGrades, teamLookup]);

  if (!trajectory.length || teamKeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        No roster data available yet
      </div>
    );
  }

  const isSinglePoint = trajectory.length === 1;

  // ─── Preseason: horizontal bar chart (sorted best → worst) ─

  if (isSinglePoint) {
    // Find Y-axis domain to zoom in on the spread
    const values = barData.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const padding = Math.max((maxVal - minVal) * 0.15, 20);
    const domainMin = Math.floor((minVal - padding) / 10) * 10;
    const domainMax = Math.ceil((maxVal + padding) / 10) * 10;

    return (
      <div className="w-full">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          📊 Pre-Season Team Rankings
          <span className="font-normal ml-2 opacity-70">
            — line chart appears once weekly actuals are uploaded
          </span>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart
            data={barData}
            margin={{ top: 5, right: 10, left: 0, bottom: 20 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={45}
              domain={[domainMin, domainMax]}
            />
            <Tooltip content={<BarTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.15 }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {barData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ─── In-season: line chart (one line per team) ─────────────

  return (
    <div className="w-full">
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        📈 Team Value Trajectory
      </div>
      <ResponsiveContainer width="100%" height={280}>
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
            width={45}
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
