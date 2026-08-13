import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Name Normalization (mirrors client/lib/trade-utils.ts) ──
const NAME_CORRECTIONS: Record<string, string> = {
  "patrick maholmes": "patrick mahomes",
  "patrick maholmes ii": "patrick mahomes",
};

function normalizeName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_CORRECTIONS[n] ?? n;
}

// ─── Schemas ─────────────────────────────────────────────────
const ActualsRowSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season: z.string(),
  overall_rank: z.coerce.number(),
  positional_rank: z.coerce.number(),
  games_played: z.coerce.number(),
  avg_points: z.coerce.number(),
  total_points: z.coerce.number(),
});

const CanonicalPlayerSchema = z.object({
  id: z.coerce.number(),
  normalized_name: z.string(),
  position: z.string().nullable(),
});

const AdpLookupSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season: z.string(),
  adp_rank: z.coerce.number(),
});

const CountSchema = z.object({ cnt: z.coerce.number() });

const PositionCountSchema = z.object({
  position: z.string(),
  season: z.string(),
  cnt: z.coerce.number(),
});

// ─── Scoring Config ──────────────────────────────────────────
const FULL_SEASON_GAMES = 17;
const DEFAULT_PPG_WEIGHT = 0.60;
const DEFAULT_AVAILABILITY_WEIGHT = 0.40;

export default api({
  name: "BuildActualsScores",
  description: "Computes position-normalized season scores from actuals data and links to canonical players.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    ppgWeight: z.number().optional(),          // Default 0.60
    availabilityWeight: z.number().optional(),  // Default 0.40
    dryRun: z.boolean().optional(),             // Default true
  }),

  output: z.object({
    totalScores: z.number(),
    seasonBreakdown: z.array(z.object({
      season: z.string(),
      playerCount: z.number(),
      matchedToCanonical: z.number(),
      unmatchedCount: z.number(),
    })),
    sampleScores: z.array(z.object({
      playerName: z.string(),
      season: z.string(),
      position: z.string(),
      ppgPercentile: z.number(),
      availabilityScore: z.number(),
      compositeScore: z.number(),
      adpRank: z.number().nullable(),
      actualRank: z.number(),
      expectationDelta: z.number().nullable(),
    })),
    committed: z.boolean(),
  }),

  async run(ctx, { ppgWeight, availabilityWeight, dryRun }) {
    const isDryRun = dryRun ?? true;
    const wPpg = ppgWeight ?? DEFAULT_PPG_WEIGHT;
    const wAvail = availabilityWeight ?? DEFAULT_AVAILABILITY_WEIGHT;

    // ── Step 1: Load all actuals ──
    // Load in batches per season to manage memory
    const seasons = [
      "2018-19", "2019-20", "2020-21", "2021-22",
      "2022-23", "2023-24", "2024-25",
    ];

    // Get position counts per season for percentile calculation
    const positionCounts = await ctx.integrations.apps_db.query(
      `SELECT position, season, COUNT(*) as cnt
       FROM ffwr_season_actuals
       GROUP BY position, season
       ORDER BY season, position`,
      PositionCountSchema,
      undefined,
      { label: "Get position counts per season" }
    );

    // Build lookup: season|position → total count
    const posCountMap = new Map<string, number>();
    for (const row of positionCounts) {
      posCountMap.set(`${row.season}|${row.position}`, row.cnt);
    }

    // ── Step 2: Load canonical player lookup ──
    const canonicalPlayers = await ctx.integrations.apps_db.query(
      `SELECT id, normalized_name, position
       FROM ffwr_canonical_players`,
      CanonicalPlayerSchema,
      undefined,
      { label: "Load canonical player lookup" }
    );

    // Build lookup: normalized_name|position → canonical_player_id
    const canonicalMap = new Map<string, number>();
    for (const cp of canonicalPlayers) {
      const key = `${cp.normalized_name}|${(cp.position ?? "").toUpperCase()}`;
      canonicalMap.set(key, cp.id);
    }
    ctx.log.info(`Canonical lookup built: ${canonicalMap.size} entries`);

    // ── Step 3: Load ADP data for expectation_delta ──
    const adpData = await ctx.integrations.apps_db.query(
      `SELECT player_name, position, season, adp_rank
       FROM ffwr_historical_adp
       ORDER BY season, adp_rank`,
      AdpLookupSchema,
      undefined,
      { label: "Load ADP data for expectation delta" }
    );

    // Build lookup: normalized_name|position|season → adp_rank
    const adpMap = new Map<string, number>();
    for (const row of adpData) {
      const norm = normalizeName(row.player_name);
      const key = `${norm}|${row.position.toUpperCase()}|${row.season}`;
      if (!adpMap.has(key)) {
        adpMap.set(key, row.adp_rank);
      }
    }
    ctx.log.info(`ADP lookup built: ${adpMap.size} entries`);

    // ── Step 4: Process each season ──
    interface ScoreRecord {
      canonicalPlayerId: number | null;
      season: string;
      overallRank: number;
      positionalRank: number;
      gamesPlayed: number;
      avgPoints: number;
      totalPoints: number;
      position: string;
      ppgPercentile: number;
      availabilityScore: number;
      compositeScore: number;
      adpRank: number | null;
      expectationDelta: number | null;
      playerName: string; // for logging only
    }

    const allScores: ScoreRecord[] = [];
    const seasonBreakdown: { season: string; playerCount: number; matchedToCanonical: number; unmatchedCount: number }[] = [];

    for (const season of seasons) {
      const actuals = await ctx.integrations.apps_db.query(
        `SELECT player_name, position, season, overall_rank, positional_rank,
                games_played, avg_points, total_points
         FROM ffwr_season_actuals
         WHERE season = $1
         ORDER BY overall_rank`,
        ActualsRowSchema,
        [season],
        { label: `Load actuals for ${season}` }
      );

      let matched = 0;
      let unmatched = 0;

      for (const row of actuals) {
        const norm = normalizeName(row.player_name);
        const pos = row.position.toUpperCase();

        // Canonical lookup
        const canonicalId = canonicalMap.get(`${norm}|${pos}`) ?? null;
        if (canonicalId) matched++;
        else unmatched++;

        // Position-normalized PPG percentile
        // percentile = (totalInPosition - positionalRank + 1) / totalInPosition * 100
        const totalInPos = posCountMap.get(`${season}|${row.position}`) ?? 1;
        const ppgPercentile = Math.round(
          ((totalInPos - row.positional_rank + 1) / totalInPos) * 100 * 10
        ) / 10;

        // Availability score: games / 17
        const availabilityScore = Math.round(
          (row.games_played / FULL_SEASON_GAMES) * 100
        ) / 100;

        // Composite: weighted average
        const compositeScore = Math.round(
          (wPpg * ppgPercentile + wAvail * (availabilityScore * 100)) * 10
        ) / 10;

        // ADP comparison
        const adpKey = `${norm}|${pos}|${season}`;
        const adpRank = adpMap.get(adpKey) ?? null;
        const expectationDelta = adpRank !== null
          ? adpRank - row.overall_rank  // positive = outperformed ADP
          : null;

        allScores.push({
          canonicalPlayerId: canonicalId,
          season,
          overallRank: row.overall_rank,
          positionalRank: row.positional_rank,
          gamesPlayed: row.games_played,
          avgPoints: row.avg_points,
          totalPoints: row.total_points,
          position: pos,
          ppgPercentile,
          availabilityScore,
          compositeScore,
          adpRank,
          expectationDelta,
          playerName: row.player_name,
        });
      }

      seasonBreakdown.push({
        season,
        playerCount: actuals.length,
        matchedToCanonical: matched,
        unmatchedCount: unmatched,
      });
      ctx.log.info(`${season}: ${actuals.length} players, ${matched} matched, ${unmatched} unmatched`);
    }

    // ── Step 5: Sample top scores ──
    const sampleScores = allScores
      .filter(s => s.season === "2024-25")
      .sort((a, b) => a.overallRank - b.overallRank)
      .slice(0, 10)
      .map(s => ({
        playerName: s.playerName,
        season: s.season,
        position: s.position,
        ppgPercentile: s.ppgPercentile,
        availabilityScore: s.availabilityScore,
        compositeScore: s.compositeScore,
        adpRank: s.adpRank,
        actualRank: s.overallRank,
        expectationDelta: s.expectationDelta,
      }));

    // ── Step 6: Commit to DB ──
    let committed = false;
    if (!isDryRun) {
      // Verify table exists
      const tableCheck = await ctx.integrations.apps_db.query(
        `SELECT COUNT(*) as cnt FROM information_schema.tables
         WHERE table_name = 'ffwr_player_scores'`,
        CountSchema,
        undefined,
        { label: "Check player_scores table exists" }
      );
      if (tableCheck[0].cnt === 0) {
        throw new Error("ffwr_player_scores table does not exist. Run InitPlayerScores first.");
      }

      // Clear existing data for fresh rebuild
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_player_scores`,
        undefined,
        { label: "Clear existing player scores" }
      );

      // Insert in batches of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < allScores.length; i += BATCH_SIZE) {
        const batch = allScores.slice(i, i + BATCH_SIZE);
        const values: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const s of batch) {
          values.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3},` +
            ` $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7},` +
            ` $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11})`
          );
          params.push(
            s.canonicalPlayerId,   // 1
            s.season,              // 2
            s.overallRank,         // 3
            s.positionalRank,      // 4
            s.gamesPlayed,         // 5
            s.avgPoints,           // 6
            s.totalPoints,         // 7
            s.position,            // 8
            s.ppgPercentile,       // 9
            s.availabilityScore,   // 10
            s.compositeScore,      // 11
            s.adpRank,             // 12
          );
          paramIdx += 12;
        }

        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_player_scores
            (canonical_player_id, season, overall_rank, positional_rank,
             games_played, avg_points, total_points, position,
             ppg_percentile, availability_score, season_actual_score, adp_rank_that_season)
           VALUES ${values.join(", ")}
           ON CONFLICT (canonical_player_id, season) DO UPDATE SET
             overall_rank = EXCLUDED.overall_rank,
             positional_rank = EXCLUDED.positional_rank,
             games_played = EXCLUDED.games_played,
             avg_points = EXCLUDED.avg_points,
             total_points = EXCLUDED.total_points,
             position = EXCLUDED.position,
             ppg_percentile = EXCLUDED.ppg_percentile,
             availability_score = EXCLUDED.availability_score,
             season_actual_score = EXCLUDED.season_actual_score,
             adp_rank_that_season = EXCLUDED.adp_rank_that_season`,
          params,
          { label: `Insert scores batch ${Math.floor(i / BATCH_SIZE) + 1}` }
        );
      }

      // Compute expectation_delta in a single UPDATE (more efficient than per-row)
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_player_scores
         SET expectation_delta = adp_rank_that_season - overall_rank
         WHERE adp_rank_that_season IS NOT NULL`,
        undefined,
        { label: "Compute expectation deltas" }
      );

      committed = true;
      ctx.log.info(`Committed ${allScores.length} player scores to DB`);
    }

    return {
      totalScores: allScores.length,
      seasonBreakdown,
      sampleScores,
      committed,
    };
  },
});
