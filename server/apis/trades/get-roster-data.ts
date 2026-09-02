import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const RosterPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: z.coerce.number().nullable(),
  positional_rank: z.coerce.number().nullable(),
  roster_team_id: z.coerce.number().nullable(),
  is_keeper: z.coerce.boolean(),
  team_name: z.string().nullable(),
  manager_name: z.string().nullable(),
});

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

const ColCheckSchema = z.object({ exists: z.coerce.boolean() });
const CountSchema = z.object({ cnt: z.coerce.number() });

/** Normalize player name for fuzzy matching between tables */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();
}

export default api({
  name: "GetRosterData",
  description: "Fetches rostered players with live Exchange ADP ranks, plus 2026 draft picks.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    rosterPlayers: z.array(RosterPlayerSchema),
    draftPicks2026: z.array(DraftPickCapitalSchema),
  }),

  async run(ctx) {
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
                p.positional_rank,
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
        RosterPlayerSchema,
        undefined,
        { label: "Fetch all rostered + drafted players" },
      );

      // Override ADP + positional rank from Exchange ADP when available
      if (exchangeAdp.length > 0) {
        rosterPlayers = rawPlayers.map((p) => {
          const nameNorm = normalizeName(p.name);
          const exchangeRank = exchangeAdpMap.get(nameNorm);
          if (exchangeRank != null) {
            // Use Exchange ADP rank and compute positional rank from it
            const posMap = posRankMap.get(p.position);
            const posRank = posMap?.get(exchangeRank) ?? p.positional_rank;
            return { ...p, adp_rank: exchangeRank, positional_rank: posRank };
          }
          return p;
        });
      } else {
        rosterPlayers = rawPlayers;
      }
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

    return { rosterPlayers, draftPicks2026 };
  },
});
