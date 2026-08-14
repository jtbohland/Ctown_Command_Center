import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const AssetInputSchema = z.object({
  type: z.enum(["player", "pick"]),
  playerName: z.string().nullable(),
  playerPosition: z.string().nullable(),
  pickYear: z.number().nullable(),
  pickRound: z.number().nullable(),
  pickNumber: z.number().nullable(),
  fromTeamId: z.number(),
  /** For 3-team trades: which team receives this asset */
  recipientTeamId: z.number().nullable(),
});

export default api({
  name: "SaveTrade",
  description: "Saves a trade with cascading roster, draft board, and treasury updates.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    teamAId: z.number(),
    teamBId: z.number(),
    teamCId: z.number().nullable(),
    season: z.string(),
    period: z.string(),
    assets: z.array(AssetInputSchema),
  }),

  output: z.object({
    message: z.string(),
    tradeId: z.number(),
    tradeNumber: z.number(),
    playersMovedCount: z.number(),
    picksMovedCount: z.number(),
  }),

  async run(ctx, { teamAId, teamBId, teamCId, season, period, assets }) {
    const isThreeTeam = teamCId != null;
    const tradeType = isThreeTeam ? "three-team" : "two-team";
    const participantCount = isThreeTeam ? 3 : 2;

    // ── Duplicate Detection ──────────────────────────────────────
    // Build a fingerprint from sorted asset descriptions to catch duplicates
    const assetFingerprint = assets
      .map((a) => {
        if (a.type === "player") return `p:${(a.playerName ?? "").toLowerCase()}`;
        return `k:${a.pickYear}-${a.pickRound}`;
      })
      .sort()
      .join("|");

    // Check for existing trade with same teams (in any order) in same season
    const DupeSchema = z.object({ trade_number: z.coerce.number(), trade_id: z.coerce.number() });
    const teamIds = [teamAId, teamBId, ...(isThreeTeam ? [teamCId!] : [])].sort((a, b) => a - b);

    const dupeQuery = isThreeTeam
      ? `SELECT t.trade_number, t.id as trade_id
         FROM ffwr_trades t
         WHERE t.season = $1
           AND ARRAY[LEAST(t.team_a_id, t.team_b_id, COALESCE(t.team_c_id, 0)), 
                     GREATEST(LEAST(t.team_a_id, t.team_b_id), LEAST(GREATEST(t.team_a_id, t.team_b_id), COALESCE(t.team_c_id, 0))),
                     GREATEST(t.team_a_id, t.team_b_id, COALESCE(t.team_c_id, 0))] 
               = ARRAY[$2::int, $3::int, $4::int]
         ORDER BY t.trade_number DESC
         LIMIT 5`
      : `SELECT t.trade_number, t.id as trade_id
         FROM ffwr_trades t
         WHERE t.season = $1
           AND LEAST(t.team_a_id, t.team_b_id) = $2
           AND GREATEST(t.team_a_id, t.team_b_id) = $3
         ORDER BY t.trade_number DESC
         LIMIT 5`;

    const dupeParams = isThreeTeam
      ? [season, teamIds[0], teamIds[1], teamIds[2]]
      : [season, Math.min(teamAId, teamBId), Math.max(teamAId, teamBId)];

    const potentialDupes = await ctx.integrations.apps_db.query(
      dupeQuery,
      DupeSchema,
      dupeParams,
      { label: "Check for duplicate trades" }
    );

    // For each potential dupe, check if the asset fingerprint matches
    if (potentialDupes.length > 0) {
      const AssetCheckSchema = z.object({
        asset_type: z.string(),
        player_name: z.string().nullable(),
        pick_year: z.coerce.number().nullable(),
        pick_round: z.coerce.number().nullable(),
      });

      for (const dupe of potentialDupes) {
        const existingAssets = await ctx.integrations.apps_db.query(
          `SELECT asset_type, player_name, pick_year, pick_round
           FROM ffwr_trade_assets WHERE trade_id = $1 LIMIT 50`,
          AssetCheckSchema,
          [dupe.trade_id],
          { label: `Check assets for trade #${dupe.trade_number}` }
        );

        const existingFingerprint = existingAssets
          .map((a) => {
            if (a.asset_type === "player") return `p:${(a.player_name ?? "").toLowerCase()}`;
            return `k:${a.pick_year}-${a.pick_round}`;
          })
          .sort()
          .join("|");

        if (existingFingerprint === assetFingerprint) {
          throw new Error(
            `Duplicate trade detected! This matches existing Trade #${dupe.trade_number} in ${season}. ` +
            `Same teams and same assets already recorded.`
          );
        }
      }
    }

    // Get next trade number for this season
    const MaxSchema = z.object({ max_num: z.coerce.number().nullable() });
    const [maxRow] = await ctx.integrations.apps_db.query(
      `SELECT MAX(trade_number) as max_num FROM ffwr_trades WHERE season = $1 LIMIT 1`,
      MaxSchema,
      [season],
      { label: "Get max trade number" }
    );
    const nextTradeNumber = (maxRow?.max_num ?? 0) + 1;

    // Insert trade with three-team fields
    const InsertSchema = z.object({ id: z.coerce.number() });
    const [inserted] = await ctx.integrations.apps_db.query(
      `INSERT INTO ffwr_trades (trade_number, season, trade_date, team_a_id, team_b_id, team_c_id, trade_type, participant_count, status, period)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, 'completed', $8)
       RETURNING id`,
      InsertSchema,
      [nextTradeNumber, season, teamAId, teamBId, teamCId, tradeType, participantCount, period],
      { label: "Insert trade record" }
    );

    const tradeId = inserted.id;

    // Track cascading updates
    const pickMoves: Array<{ year: number; round: number; fromTeamId: number; toTeamId: number }> = [];
    const playerMoves: Array<{ playerName: string; toTeamId: number }> = [];

    for (const asset of assets) {
      // Determine recipient: explicit for 3-team, inferred for 2-team
      const recipientTeamId = isThreeTeam
        ? asset.recipientTeamId!
        : (asset.fromTeamId === teamAId ? teamBId : teamAId);

      const destinationExplicit = isThreeTeam;

      if (asset.type === "player") {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, recipient_team_id, destination_explicit, asset_type, player_name, player_position)
           VALUES ($1, $2, $3, $4, 'player', $5, $6)`,
          [tradeId, asset.fromTeamId, recipientTeamId, destinationExplicit, asset.playerName, asset.playerPosition],
          { label: `Insert player asset: ${asset.playerName}` }
        );

        // Track player move for roster cascade
        if (asset.playerName) {
          playerMoves.push({ playerName: asset.playerName, toTeamId: recipientTeamId });
        }
      } else {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, recipient_team_id, destination_explicit, asset_type, pick_year, pick_round, pick_number)
           VALUES ($1, $2, $3, $4, 'pick', $5, $6, $7)`,
          [tradeId, asset.fromTeamId, recipientTeamId, destinationExplicit, asset.pickYear, asset.pickRound, asset.pickNumber],
          { label: `Insert pick asset: ${asset.pickYear} Rd ${asset.pickRound}` }
        );

        // Track pick move for draft board + treasury cascade
        if (asset.pickYear && asset.pickRound) {
          pickMoves.push({
            year: asset.pickYear,
            round: asset.pickRound,
            fromTeamId: asset.fromTeamId,
            toTeamId: recipientTeamId,
          });
        }
      }
    }

    // ── Cascade 1: Roster updates (drafted_team_id + roster_team_id) ──
    for (const move of playerMoves) {
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET drafted_team_id = $1, roster_team_id = $1
         WHERE LOWER(name) = LOWER($2) AND is_drafted = true`,
        [move.toTeamId, move.playerName],
        { label: `Roster move: ${move.playerName} → team ${move.toTeamId}` }
      );
    }

    // ── Cascade 2: Draft Board (ffwr_draft_picks.team_id) — current year only ──
    const CURRENT_DRAFT_YEAR = 2026;
    for (const move of pickMoves) {
      if (move.year === CURRENT_DRAFT_YEAR) {
        await ctx.integrations.apps_db.execute(
          `UPDATE ffwr_draft_picks
           SET team_id = $1
           WHERE round = $2 AND team_id = $3`,
          [move.toTeamId, move.round, move.fromTeamId],
          { label: `Draft board: Rd ${move.round} slot → team ${move.toTeamId}` }
        );
      }
    }

    // ── Cascade 3: Treasury (ffwr_draft_capital.current_team_id) ──
    for (const move of pickMoves) {
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_draft_capital
         SET current_team_id = $1
         WHERE year = $2 AND round = $3 AND current_team_id = $4`,
        [move.toTeamId, move.year, move.round, move.fromTeamId],
        { label: `Treasury: ${move.year} Rd ${move.round} → team ${move.toTeamId}` }
      );
    }

    // Build summary
    const parts: string[] = [];
    if (playerMoves.length > 0) parts.push(`${playerMoves.length} player${playerMoves.length > 1 ? "s" : ""} moved`);
    if (pickMoves.length > 0) parts.push(`${pickMoves.length} pick${pickMoves.length > 1 ? "s" : ""} reassigned`);
    const summary = parts.length > 0 ? ` — ${parts.join(", ")}` : "";

    return {
      message: `Trade #${nextTradeNumber} saved successfully!${summary}`,
      tradeId,
      tradeNumber: nextTradeNumber,
      playersMovedCount: playerMoves.length,
      picksMovedCount: pickMoves.length,
    };
  },
});
