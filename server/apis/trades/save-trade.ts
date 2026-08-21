import { api, z, postgres } from "@superblocksteam/sdk-api";
import { CURRENT_DRAFT_YEAR } from "../../lib/valuation/valuation-spec.js";
import { requireAdmin } from "../../lib/auth/require-admin.js";

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
    notes: z.string().nullable(),
    assets: z.array(AssetInputSchema),
    /**
     * When true, validate and plan the trade WITHOUT writing anything.
     * Duplicate detection and trade-number lookup still run (both read-only),
     * and the full cascade plan is returned, but no INSERT/UPDATE is issued.
     * Lets the trade path be exercised safely against the live league DB.
     */
    dryRun: z.boolean().nullable(),
  }),

  output: z.object({
    message: z.string(),
    tradeId: z.number(),
    tradeNumber: z.number(),
    playersMovedCount: z.number(),
    picksMovedCount: z.number(),
    /** True when the call was planned only and nothing was persisted. */
    dryRun: z.boolean(),
  }),

  async run(ctx, { teamAId, teamBId, teamCId, season, period, notes, assets, dryRun }) {
    const isDryRun = dryRun === true;

    // Authorization gate — must run before any query or write.
    // Enforced even for dry runs so the preview path cannot be used to probe
    // league data (duplicate detection reads real trades).
    requireAdmin(ctx, isDryRun ? "preview a trade" : "save a trade");

    // [Phase 4] Explicit error states — reject obviously invalid input
    if (assets.length === 0) {
      throw new Error("Cannot save a trade with zero assets. Add at least one player or pick.");
    }
    if (teamAId === teamBId) {
      throw new Error("Team A and Team B must be different teams.");
    }
    if (teamCId != null && (teamCId === teamAId || teamCId === teamBId)) {
      throw new Error("Team C must be different from Teams A and B.");
    }

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

    // ── Plan the trade (pure — no writes) ────────────────────────
    // Resolve every recipient and derive the roster / draft-board / treasury
    // moves BEFORE touching the database. This lets a dry run report exactly
    // what would happen, and keeps planning logic identical on both paths.
    const destinationExplicit = isThreeTeam;

    const plannedAssets = assets.map((asset) => ({
      asset,
      // Determine recipient: explicit for 3-team, inferred for 2-team
      recipientTeamId: isThreeTeam
        ? asset.recipientTeamId!
        : (asset.fromTeamId === teamAId ? teamBId : teamAId),
    }));

    const pickMoves: Array<{ year: number; round: number; fromTeamId: number; toTeamId: number; pickNumber: number | null }> = [];
    const playerMoves: Array<{ playerName: string; toTeamId: number }> = [];

    for (const { asset, recipientTeamId } of plannedAssets) {
      if (asset.type === "player") {
        // Track player move for roster cascade
        if (asset.playerName) {
          playerMoves.push({ playerName: asset.playerName, toTeamId: recipientTeamId });
        }
      } else if (asset.pickYear && asset.pickRound) {
        // Track pick move for draft board + treasury cascade
        pickMoves.push({
          year: asset.pickYear,
          round: asset.pickRound,
          fromTeamId: asset.fromTeamId,
          toTeamId: recipientTeamId,
          pickNumber: asset.pickNumber ?? null,
        });
      }
    }

    // Build summary (shared by dry run and real save)
    const parts: string[] = [];
    if (playerMoves.length > 0) parts.push(`${playerMoves.length} player${playerMoves.length > 1 ? "s" : ""} moved`);
    if (pickMoves.length > 0) parts.push(`${pickMoves.length} pick${pickMoves.length > 1 ? "s" : ""} reassigned`);
    const summary = parts.length > 0 ? ` — ${parts.join(", ")}` : "";

    // ── Dry run short-circuit — everything below this line writes ──
    if (isDryRun) {
      return {
        message: `Dry run OK — Trade #${nextTradeNumber} would be saved${summary}. No changes were written.`,
        tradeId: -1,
        tradeNumber: nextTradeNumber,
        playersMovedCount: playerMoves.length,
        picksMovedCount: pickMoves.length,
        dryRun: true,
      };
    }

    // ── Atomic write — single PL/pgSQL block ─────────────────────
    // The SDK has no BEGIN/COMMIT, but PL/pgSQL DO blocks run inside an
    // implicit transaction. If any statement in the block fails, the entire
    // block rolls back — no partial trade, no orphan assets, no dangling
    // pick ownership changes.
    //
    // We build the SQL string in JS from the pure plan computed above and
    // send it in one `execute()` call, then retrieve the new trade_id with
    // a follow-up read (the DO block cannot RETURN values).

    /** Escape a string for use inside a SQL literal (double single-quotes). */
    const esc = (v: string | null | undefined): string =>
      v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
    const num = (v: number | null | undefined): string =>
      v == null ? "NULL" : String(Number(v));

    // ── Build asset INSERT values ──
    const assetValues = plannedAssets.map(({ asset, recipientTeamId }) => {
      if (asset.type === "player") {
        return `(new_trade_id, ${num(asset.fromTeamId)}, ${num(recipientTeamId)}, ${destinationExplicit}, 'player', ${esc(asset.playerName)}, ${esc(asset.playerPosition)}, NULL, NULL, NULL)`;
      }
      return `(new_trade_id, ${num(asset.fromTeamId)}, ${num(recipientTeamId)}, ${destinationExplicit}, 'pick', NULL, NULL, ${num(asset.pickYear)}, ${num(asset.pickRound)}, ${num(asset.pickNumber)})`;
    });

    // ── Build cascade statements ──
    const cascadeStmts: string[] = [];

    // Cascade 1: Roster moves
    for (const move of playerMoves) {
      cascadeStmts.push(
        `UPDATE ffwr_players SET drafted_team_id = ${num(move.toTeamId)}, roster_team_id = ${num(move.toTeamId)} WHERE LOWER(name) = LOWER(${esc(move.playerName)}) AND is_drafted = true;`
      );
    }

    // Cascade 2: Draft board (current year only)
    for (const move of pickMoves) {
      if (move.year === CURRENT_DRAFT_YEAR) {
        if (move.pickNumber) {
          cascadeStmts.push(
            `UPDATE ffwr_draft_picks SET team_id = ${num(move.toTeamId)} WHERE overall_pick = ${num(move.pickNumber)};`
          );
        } else {
          cascadeStmts.push(
            `UPDATE ffwr_draft_picks SET team_id = ${num(move.toTeamId)} WHERE id = (SELECT id FROM ffwr_draft_picks WHERE round = ${num(move.round)} AND team_id = ${num(move.fromTeamId)} LIMIT 1);`
          );
        }
      }
    }

    // Cascade 3: Treasury
    for (const move of pickMoves) {
      if (move.year === CURRENT_DRAFT_YEAR && move.pickNumber) {
        cascadeStmts.push(
          `UPDATE ffwr_draft_capital SET current_team_id = ${num(move.toTeamId)} WHERE year = ${num(move.year)} AND round = ${num(move.round)} AND original_team_id = (SELECT pick_in_round FROM ffwr_draft_picks WHERE overall_pick = ${num(move.pickNumber)} LIMIT 1);`
        );
      } else {
        cascadeStmts.push(
          `UPDATE ffwr_draft_capital SET current_team_id = ${num(move.toTeamId)} WHERE id = (SELECT id FROM ffwr_draft_capital WHERE year = ${num(move.year)} AND round = ${num(move.round)} AND current_team_id = ${num(move.fromTeamId)} LIMIT 1);`
        );
      }
    }

    const atomicSql = `
      DO $$
      DECLARE
        new_trade_id INT;
      BEGIN
        -- 1. Insert the trade record
        INSERT INTO ffwr_trades (trade_number, season, trade_date, team_a_id, team_b_id, team_c_id, trade_type, participant_count, status, period, notes)
        VALUES (${num(nextTradeNumber)}, ${esc(season)}, CURRENT_DATE, ${num(teamAId)}, ${num(teamBId)}, ${num(teamCId)}, ${esc(tradeType)}, ${num(participantCount)}, 'completed', ${esc(period)}, ${esc(notes)})
        RETURNING id INTO new_trade_id;

        -- 2. Insert all trade assets
        INSERT INTO ffwr_trade_assets (trade_id, from_team_id, recipient_team_id, destination_explicit, asset_type, player_name, player_position, pick_year, pick_round, pick_number)
        VALUES ${assetValues.join(",\n               ")};

        -- 3. Cascade roster, draft board, and treasury updates
        ${cascadeStmts.join("\n        ")}
      END $$;
    `;

    await ctx.integrations.apps_db.execute(atomicSql, undefined, {
      label: `Atomic SaveTrade #${nextTradeNumber} (${plannedAssets.length} assets, ${playerMoves.length} roster moves, ${pickMoves.length} pick moves)`,
    });

    // Retrieve the trade_id we just created (DO blocks can't return values)
    const InsertSchema = z.object({ id: z.coerce.number() });
    const [inserted] = await ctx.integrations.apps_db.query(
      `SELECT id FROM ffwr_trades WHERE trade_number = $1 AND season = $2 ORDER BY id DESC LIMIT 1`,
      InsertSchema,
      [nextTradeNumber, season],
      { label: "Retrieve new trade ID" }
    );

    if (!inserted) {
      throw new Error(`Atomic write appeared to succeed but trade #${nextTradeNumber} was not found — this should never happen.`);
    }

    return {
      message: `Trade #${nextTradeNumber} saved successfully!${summary}`,
      tradeId: inserted.id,
      tradeNumber: nextTradeNumber,
      playersMovedCount: playerMoves.length,
      picksMovedCount: pickMoves.length,
      dryRun: false,
    };
  },
});
