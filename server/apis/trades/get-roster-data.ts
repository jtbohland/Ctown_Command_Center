import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const RawPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: z.coerce.number().nullable(),
  positional_rank: z.coerce.number().nullable(),
  dynasty_rank: z.coerce.number().nullable(),
  roster_team_id: z.coerce.number().nullable(),
  is_keeper: z.coerce.boolean(),
  team_name: z.string().nullable(),
  manager_name: z.string().nullable(),
});

const RosterPlayerSchema = RawPlayerSchema.omit({ dynasty_rank: true }).extend({
  blended_value: z.number(),
});

// ─── Value computation (mirrors GetRosterGrades logic) ───────
const MAX_ADP = 500;

function computePlayerValue(adpRank: number | null, dynastyRank?: number | null): number {
  if (adpRank == null || adpRank <= 0) return 0;
  const adpVal = Math.round(((MAX_ADP - Math.min(adpRank, MAX_ADP) + 1) / MAX_ADP) * 100 * 10) / 10;
  if (dynastyRank == null || dynastyRank <= 0) return adpVal;
  const dynVal = Math.round(((MAX_ADP - Math.min(dynastyRank, MAX_ADP) + 1) / MAX_ADP) * 100 * 10) / 10;
  return Math.round((0.60 * adpVal + 0.40 * dynVal) * 10) / 10;
}

function getActualsWeight(lastCompletedWeek: number): number {
  if (lastCompletedWeek <= 0) return 0;
  if (lastCompletedWeek <= 3) return Math.round((0.12 + (lastCompletedWeek - 1) * (0.13 / 2)) * 1000) / 1000;
  if (lastCompletedWeek <= 8) return Math.round((0.30 + (lastCompletedWeek - 4) * (0.15 / 4)) * 1000) / 1000;
  if (lastCompletedWeek <= 14) return Math.round((0.50 + (lastCompletedWeek - 9) * (0.15 / 5)) * 1000) / 1000;
  if (lastCompletedWeek <= 17) return Math.round((0.70 + (lastCompletedWeek - 15) * (0.10 / 2)) * 1000) / 1000;
  return 0.85;
}

const DraftPickCapitalSchema = z.object({
  round: z.coerce.number(),
  pick_in_round: z.coerce.number(),
  overall_pick: z.coerce.number(),
  team_id: z.coerce.number(),
  team_name: z.string(),
  manager_name: z.string(),
  player_id: z.coerce.number().nullable(),
  is_complete: z.coerce.boolean(),
});

const ExchangeAdpSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  adp_rank: z.coerce.number(),
});

const ActualsRankSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  positional_rank: z.coerce.number(),
  overall_rank: z.coerce.number(),
});

const WeekCheckSchema = z.object({ week_num: z.coerce.number() });

const ColCheckSchema = z.object({ exists: z.coerce.boolean() });
const CountSchema = z.object({ cnt: z.coerce.number() });

/** Normalize player name for fuzzy matching between tables */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "") // strip suffixes BEFORE removing non-alpha
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export default api({
  name: "GetRosterData",
  description: "Fetches rostered players with live Exchange ADP ranks, plus 2026 draft picks.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    season: z.string().optional(),
  }),

  output: z.object({
    rosterPlayers: z.array(RosterPlayerSchema),
    draftPicks2026: z.array(DraftPickCapitalSchema),
    hasActuals: z.boolean(),
    lastCompletedWeek: z.number(),
  }),

  async run(ctx, { season: seasonInput }) {
    const season = seasonInput ?? "2026-27";
    // ── 1. Load Exchange ADP (latest uploaded sheet) ──────────
    let exchangeAdp: z.infer<typeof ExchangeAdpSchema>[] = [];
    try {
      const [{ cnt }] = await ctx.integrations.apps_db.query(
        `SELECT COUNT(*) as cnt FROM ffwr_exchange_adp`,
        CountSchema,
        undefined,
        { label: "Check Exchange ADP count" },
      );
      if (cnt > 0) {
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
      // Table doesn't exist yet — fall back to ffwr_players columns
    }

    // Build Exchange ADP lookup: normalized name → overall rank
    const exchangeAdpMap = new Map<string, number>();
    for (const row of exchangeAdp) {
      exchangeAdpMap.set(normalizeName(row.player_name), row.adp_rank);
    }

    // Build positional rank lookup from Exchange ADP ordering
    // e.g. if Exchange has WRs at ranks 3,4,6,8,... then WR at rank 3 = WR1, rank 4 = WR2, etc.
    const posRankMap = new Map<string, Map<number, number>>(); // position → (overallRank → posRank)
    const posCounts = new Map<string, number>();
    for (const row of exchangeAdp) {
      const pos = row.position;
      if (!posCounts.has(pos)) posCounts.set(pos, 0);
      posCounts.set(pos, posCounts.get(pos)! + 1);
      if (!posRankMap.has(pos)) posRankMap.set(pos, new Map());
      posRankMap.get(pos)!.set(row.adp_rank, posCounts.get(pos)!);
    }

    // ── 1b. Load actuals-based positional ranks if season data exists ──
    let hasActuals = false;
    let lastCompletedWeek = 0;
    const actualsRankMap = new Map<string, { positional_rank: number; overall_rank: number }>();

    try {
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
      hasActuals = lastCompletedWeek > 0;

      if (hasActuals) {
        const actualsRows = await ctx.integrations.apps_db.query(
          `SELECT player_name, position, positional_rank, overall_rank
           FROM ffwr_season_actuals
           WHERE season = $1
           ORDER BY overall_rank
           LIMIT 600`,
          ActualsRankSchema,
          [season],
          { label: "Load actuals positional ranks" },
        );
        for (const row of actualsRows) {
          actualsRankMap.set(normalizeName(row.player_name), {
            positional_rank: row.positional_rank,
            overall_rank: row.overall_rank,
          });
        }
        ctx.log.info(`Loaded ${actualsRows.length} actuals ranks for ${season} (week ${lastCompletedWeek})`);
      }
    } catch {
      // No actuals table yet
    }

    // ── 2. Check if roster_team_id column exists ─────────────
    const [{ exists: colExists }] = await ctx.integrations.apps_db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ffwr_players' AND column_name = 'roster_team_id'
       ) AS exists`,
      ColCheckSchema,
      undefined,
      { label: "Check if roster_team_id column exists" },
    );

    let rosterPlayers: z.infer<typeof RosterPlayerSchema>[] = [];

    if (colExists) {
      const rawPlayers = await ctx.integrations.apps_db.query(
        `SELECT p.id, p.name, p.position, p.nfl_team, p.adp_rank,
                p.positional_rank, p.dynasty_rank,
                COALESCE(p.roster_team_id, p.drafted_team_id) AS roster_team_id,
                p.is_keeper,
                COALESCE(rt.team_name, dt.team_name) AS team_name,
                COALESCE(rt.manager_name, dt.manager_name) AS manager_name
         FROM ffwr_players p
         LEFT JOIN ffwr_teams rt ON rt.id = p.roster_team_id
         LEFT JOIN ffwr_teams dt ON dt.id = p.drafted_team_id
         WHERE p.roster_team_id IS NOT NULL OR p.drafted_team_id IS NOT NULL
         ORDER BY COALESCE(rt.manager_name, dt.manager_name),
           CASE p.position WHEN 'QB' THEN 1 WHEN 'RB' THEN 2 WHEN 'WR' THEN 3 WHEN 'TE' THEN 4 ELSE 5 END,
           p.adp_rank ASC NULLS LAST
         LIMIT 500`,
        RawPlayerSchema,
        undefined,
        { label: "Fetch all rostered + drafted players" },
      );

      // Override ADP from Exchange ADP + positional rank from actuals (or ADP fallback)
      rosterPlayers = rawPlayers.map((p) => {
        const nameNorm = normalizeName(p.name);

        // ADP: prefer Exchange ADP, fall back to draft ADP
        const exchangeRank = exchangeAdpMap.get(nameNorm);
        const adpRank = exchangeRank ?? p.adp_rank;

        // Positional rank: prefer actuals when season has started, fall back to ADP-based
        // -1 = DNP sentinel (player not in actuals during active season)
        let posRank = p.positional_rank;
        if (hasActuals) {
          const actualsData = actualsRankMap.get(nameNorm);
          if (actualsData) {
            posRank = actualsData.positional_rank;
          } else {
            posRank = -1; // DNP — not in actuals data
          }
        } else if (exchangeRank != null) {
          const posMap = posRankMap.get(p.position);
          posRank = posMap?.get(exchangeRank) ?? p.positional_rank;
        }

        // Compute blended value: baseline × (1-w) + actuals × w
        const baselineValue = computePlayerValue(adpRank, p.dynasty_rank);
        const actualsWeight = getActualsWeight(lastCompletedWeek);
        let blendedValue = baselineValue;

        if (actualsWeight > 0) {
          const actualsData = actualsRankMap.get(nameNorm);
          if (actualsData) {
            const actualsValue = computePlayerValue(actualsData.overall_rank);
            blendedValue = baselineValue * (1 - actualsWeight) + actualsValue * actualsWeight;
          } else {
            // DNP: last-place actuals value
            const dnpRank = actualsRankMap.size + 1;
            const dnpValue = computePlayerValue(dnpRank);
            blendedValue = baselineValue * (1 - actualsWeight) + dnpValue * actualsWeight;
          }
        }

        return {
          id: p.id,
          name: p.name,
          position: p.position,
          nfl_team: p.nfl_team,
          adp_rank: adpRank,
          positional_rank: posRank,
          blended_value: Math.round(blendedValue * 10) / 10,
          roster_team_id: p.roster_team_id,
          is_keeper: p.is_keeper,
          team_name: p.team_name,
          manager_name: p.manager_name,
        };
      });
    }

    // ── 3. Fetch 2026 draft picks for Treasury ───────────────
    const draftPicks2026 = await ctx.integrations.apps_db.query(
      `SELECT dp.round, dp.pick_in_round, dp.overall_pick,
              dp.team_id, t.team_name, t.manager_name,
              dp.player_id, dp.is_complete
       FROM ffwr_draft_picks dp
       JOIN ffwr_teams t ON t.id = dp.team_id
       ORDER BY dp.round, dp.pick_in_round
       LIMIT 200`,
      DraftPickCapitalSchema,
      undefined,
      { label: "Fetch 2026 draft picks for Treasury" },
    );

    return { rosterPlayers, draftPicks2026, hasActuals, lastCompletedWeek };
  },
});
