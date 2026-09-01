import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Schemas ─────────────────────────────────────────────────

const ExchangeAdpSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  adp_rank: z.coerce.number(),
});

const RosterPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  roster_team_id: z.coerce.number().nullable(),
});

const ActualsRowSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  total_points: z.coerce.number(),
  avg_points: z.coerce.number(),
  games_played: z.coerce.number(),
  overall_rank: z.coerce.number(),
});

const WeekCheckSchema = z.object({
  week_num: z.coerce.number(),
});

const CountSchema = z.object({ cnt: z.coerce.number() });

// ─── Constants (C-Town ramp) ─────────────────────────────────

const MAX_ADP = 500;

function computePlayerValue(adpRank: number | null): number {
  if (adpRank == null || adpRank <= 0) return 0;
  const clamped = Math.min(adpRank, MAX_ADP);
  return Math.round(((MAX_ADP - clamped + 1) / MAX_ADP) * 100 * 10) / 10;
}

/** C-Town roster grade ramp (separate from trade verdicts) */
function getActualsWeight(lastCompletedWeek: number): number {
  if (lastCompletedWeek <= 0) return 0;
  if (lastCompletedWeek <= 3) return Math.round((0.12 + (lastCompletedWeek - 1) * (0.13 / 2)) * 1000) / 1000;
  if (lastCompletedWeek <= 8) return Math.round((0.30 + (lastCompletedWeek - 4) * (0.15 / 4)) * 1000) / 1000;
  if (lastCompletedWeek <= 14) return Math.round((0.50 + (lastCompletedWeek - 9) * (0.15 / 5)) * 1000) / 1000;
  if (lastCompletedWeek <= 17) return Math.round((0.70 + (lastCompletedWeek - 15) * (0.10 / 2)) * 1000) / 1000;
  return 0.85;
}

const GRADE_LADDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"] as const;

function rankToGrade(rank: number, totalTeams: number): string {
  if (totalTeams <= 0 || rank <= 0) return "F";
  const idx = Math.min(
    Math.floor(((rank - 1) / totalTeams) * GRADE_LADDER.length),
    GRADE_LADDER.length - 1,
  );
  return GRADE_LADDER[idx];
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();
}

// ─── Output schemas ──────────────────────────────────────────

const TeamGradeSchema = z.object({
  teamId: z.number(),
  totalValue: z.number(),
  rank: z.number(),
  grade: z.string(),
  playerCount: z.number(),
});

const TrajectoryPointSchema = z.object({
  week: z.number(), // 0 = preseason, 1-17 = in-season
  label: z.string(),
  // team_<id> fields added dynamically
});

export default api({
  name: "GetRosterGrades",
  description: "Computes team grades + trajectory from Exchange ADP and season actuals.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    season: z.string().default("2026-27"),
  }),

  output: z.object({
    teamGrades: z.array(TeamGradeSchema),
    trajectory: z.array(z.any()), // dynamic team columns
    hasExchangeAdp: z.boolean(),
    lastCompletedWeek: z.number(),
    actualsWeight: z.number(),
  }),

  async run(ctx, { season }) {
    // 1. Check if Exchange ADP table exists and has data
    let hasExchangeAdp = false;
    let exchangeAdp: z.infer<typeof ExchangeAdpSchema>[] = [];

    try {
      const [{ cnt }] = await ctx.integrations.apps_db.query(
        `SELECT COUNT(*) as cnt FROM ffwr_exchange_adp`,
        CountSchema,
        undefined,
        { label: "Check Exchange ADP count" },
      );
      hasExchangeAdp = cnt > 0;

      if (hasExchangeAdp) {
        exchangeAdp = await ctx.integrations.apps_db.query(
          `SELECT player_name, position, adp_rank
           FROM ffwr_exchange_adp
           ORDER BY adp_rank
           LIMIT 600`,
          ExchangeAdpSchema,
          undefined,
          { label: "Load Exchange ADP" },
        );
      }
    } catch {
      // Table doesn't exist yet — will be created by InitExchangeAdp
      hasExchangeAdp = false;
    }

    // Build Exchange ADP lookup
    const exchangeAdpMap = new Map<string, number>();
    for (const row of exchangeAdp) {
      exchangeAdpMap.set(normalizeName(row.player_name), row.adp_rank);
    }

    // 2. Load rostered players
    const rosterPlayers = await ctx.integrations.apps_db.query(
      `SELECT p.id, p.name, p.position,
              COALESCE(p.roster_team_id, p.drafted_team_id) AS roster_team_id
       FROM ffwr_players p
       WHERE p.roster_team_id IS NOT NULL OR p.drafted_team_id IS NOT NULL
       ORDER BY p.id
       LIMIT 500`,
      RosterPlayerSchema,
      undefined,
      { label: "Load rostered players" },
    );

    // Group by team
    const teamPlayers = new Map<number, z.infer<typeof RosterPlayerSchema>[]>();
    for (const p of rosterPlayers) {
      if (!p.roster_team_id) continue;
      if (!teamPlayers.has(p.roster_team_id)) teamPlayers.set(p.roster_team_id, []);
      teamPlayers.get(p.roster_team_id)!.push(p);
    }

    // 3. Determine how many weeks of actuals are available
    let lastCompletedWeek = 0;
    let actualsMap = new Map<string, z.infer<typeof ActualsRowSchema>>();

    try {
      // Check which week columns have non-null data
      const weekChecks = await ctx.integrations.apps_db.query(
        `SELECT unnest(ARRAY[
          CASE WHEN SUM(CASE WHEN week_1 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_2 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 2 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_3 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 3 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_4 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 4 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_5 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 5 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_6 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 6 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_7 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 7 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_8 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 8 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_9 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 9 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_10 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 10 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_11 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 11 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_12 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 12 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_13 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 13 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_14 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 14 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_15 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 15 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_16 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 16 ELSE 0 END,
          CASE WHEN SUM(CASE WHEN week_17 IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 17 ELSE 0 END
        ]) AS week_num
        FROM ffwr_season_actuals
        WHERE season = $1`,
        WeekCheckSchema,
        [season],
        { label: "Check which weeks have actuals" },
      );

      for (const row of weekChecks) {
        if (row.week_num > lastCompletedWeek) lastCompletedWeek = row.week_num;
      }

      // Load actuals if available
      if (lastCompletedWeek > 0) {
        const actualsRows = await ctx.integrations.apps_db.query(
          `SELECT player_name, position, total_points, avg_points, games_played, overall_rank
           FROM ffwr_season_actuals
           WHERE season = $1
           ORDER BY overall_rank
           LIMIT 600`,
          ActualsRowSchema,
          [season],
          { label: "Load season actuals" },
        );
        for (const row of actualsRows) {
          actualsMap.set(normalizeName(row.player_name), row);
        }
      }
    } catch {
      // No actuals table/data yet — purely preseason
    }

    const actualsWeight = getActualsWeight(lastCompletedWeek);
    const allTeamIds = Array.from(teamPlayers.keys()).sort((a, b) => a - b);
    const totalTeams = allTeamIds.length || 11;

    // 4. Compute current team values
    function computeTeamValue(teamId: number, weekWeight: number): number {
      const players = teamPlayers.get(teamId) ?? [];
      let totalValue = 0;

      for (const player of players) {
        const nameNorm = normalizeName(player.name);

        // Baseline: Exchange ADP if available, otherwise fall back to player's draft ADP
        const exchangeRank = exchangeAdpMap.get(nameNorm);
        const baselineValue = exchangeRank
          ? computePlayerValue(exchangeRank)
          : computePlayerValue(null); // No Exchange ADP = 0 value for grading

        if (weekWeight === 0 || !actualsMap.has(nameNorm)) {
          // Preseason or no actuals for this player → pure ADP
          totalValue += baselineValue;
        } else {
          // Blended: baseline × (1 - weight) + actuals_value × weight
          const actuals = actualsMap.get(nameNorm)!;
          // Normalize actuals rank to 0-100 scale (like ADP value)
          const actualsValue = computePlayerValue(actuals.overall_rank);
          totalValue += baselineValue * (1 - weekWeight) + actualsValue * weekWeight;
        }
      }

      return Math.round(totalValue * 10) / 10;
    }

    // Current grades
    const teamValues = allTeamIds.map((teamId) => ({
      teamId,
      totalValue: computeTeamValue(teamId, actualsWeight),
      playerCount: (teamPlayers.get(teamId) ?? []).length,
    }));

    // Sort by value descending to assign ranks
    teamValues.sort((a, b) => b.totalValue - a.totalValue);
    const teamGrades: z.infer<typeof TeamGradeSchema>[] = teamValues.map((tv, idx) => ({
      ...tv,
      rank: idx + 1,
      grade: rankToGrade(idx + 1, totalTeams),
    }));

    // 5. Build trajectory (preseason + each completed week)
    const trajectory: Array<Record<string, number | string>> = [];

    // Preseason point (week 0 = pure ADP)
    const preseasonPoint: Record<string, number | string> = { week: 0, label: "Pre" };
    for (const teamId of allTeamIds) {
      preseasonPoint[`team_${teamId}`] = computeTeamValue(teamId, 0);
    }
    trajectory.push(preseasonPoint);

    // One point per completed week
    for (let w = 1; w <= lastCompletedWeek; w++) {
      const weekWeight = getActualsWeight(w);
      const point: Record<string, number | string> = {
        week: w,
        label: w <= 14 ? `Wk ${w}` : `PO ${w - 14}`,
      };
      for (const teamId of allTeamIds) {
        point[`team_${teamId}`] = computeTeamValue(teamId, weekWeight);
      }
      trajectory.push(point);
    }

    return {
      teamGrades,
      trajectory,
      hasExchangeAdp,
      lastCompletedWeek,
      actualsWeight,
    };
  },
});
