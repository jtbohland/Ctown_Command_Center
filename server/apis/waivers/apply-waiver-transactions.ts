import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Input Schema (matches ParseWaiverScreenshot output) ─────
const TransactionInputSchema = z.object({
  added_player_name: z.string().nullable(),
  added_player_position: z.string().nullable(),
  added_player_nfl_team: z.string().nullable(),
  added_player_id: z.number().nullable(),
  added_player_matched: z.boolean(),
  dropped_player_name: z.string().nullable(),
  dropped_player_position: z.string().nullable(),
  dropped_player_nfl_team: z.string().nullable(),
  dropped_player_id: z.number().nullable(),
  dropped_player_matched: z.boolean(),
  manager_name: z.string(),
  team_id: z.number().nullable(),
  team_matched: z.boolean(),
  transaction_date: z.string(),
  transaction_time: z.string().nullable(),
  is_duplicate: z.boolean(),
});

const NewPlayerIdSchema = z.object({ id: z.coerce.number() });

export default api({
  name: "ApplyWaiverTransactions",
  description: "Inserts waiver transactions, creates missing players, and updates rosters.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    transactions: z.array(TransactionInputSchema),
    season: z.string(),
  }),

  output: z.object({
    applied: z.number(),
    skippedDuplicates: z.number(),
    playersCreated: z.number(),
    rosterChanges: z.number(),
    errors: z.array(z.string()),
  }),

  async run(ctx, { transactions, season }) {
    let applied = 0;
    let skippedDuplicates = 0;
    let playersCreated = 0;
    let rosterChanges = 0;
    const errors: string[] = [];

    for (const txn of transactions) {
      // Skip duplicates
      if (txn.is_duplicate) {
        skippedDuplicates++;
        continue;
      }

      // Must have a team match to apply roster changes
      if (!txn.team_id) {
        errors.push(`Skipped: manager "${txn.manager_name}" not matched to a team`);
        continue;
      }

      // ── Resolve added player ID (create if missing) ──
      let addedPlayerId = txn.added_player_id;
      if (txn.added_player_name && !addedPlayerId) {
        // Create the player in ffwr_players
        try {
          const rows = await ctx.integrations.apps_db.query(
            `INSERT INTO ffwr_players (name, position, nfl_team, adp_rank, is_drafted, drafted_team_id, roster_team_id)
             VALUES ($1, $2, $3, 999, true, $4, $4)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            NewPlayerIdSchema,
            [
              txn.added_player_name,
              txn.added_player_position ?? "UNK",
              txn.added_player_nfl_team ?? "FA",
              txn.team_id,
            ],
            { label: `Create new player: ${txn.added_player_name}` },
          );
          if (rows.length > 0) {
            addedPlayerId = rows[0].id;
            playersCreated++;
            ctx.log.info(`Created new player: ${txn.added_player_name} (id=${addedPlayerId})`);
          } else {
            // Player exists but wasn't matched — try to find by normalized name
            const norm = normalizeName(txn.added_player_name);
            const found = await ctx.integrations.apps_db.query(
              `SELECT id FROM ffwr_players WHERE LOWER(REPLACE(REPLACE(name, '.', ''), '''', '')) LIKE $1 LIMIT 1`,
              NewPlayerIdSchema,
              [`%${norm}%`],
              { label: `Fuzzy search for ${txn.added_player_name}` },
            );
            if (found.length > 0) {
              addedPlayerId = found[0].id;
            }
          }
        } catch (err) {
          errors.push(`Failed to create player ${txn.added_player_name}: ${String(err)}`);
        }
      }

      // ── Process roster changes ──
      // 1. Add player to team's roster
      if (addedPlayerId && txn.team_id) {
        try {
          await ctx.integrations.apps_db.execute(
            `UPDATE ffwr_players
             SET is_drafted = true, drafted_team_id = $1, roster_team_id = $1
             WHERE id = $2`,
            [txn.team_id, addedPlayerId],
            { label: `Add ${txn.added_player_name} to team ${txn.team_id}` },
          );
          rosterChanges++;
        } catch (err) {
          errors.push(`Failed to add ${txn.added_player_name}: ${String(err)}`);
        }
      }

      // 2. Drop player from roster (release to FA)
      if (txn.dropped_player_id) {
        try {
          await ctx.integrations.apps_db.execute(
            `UPDATE ffwr_players
             SET is_drafted = false, drafted_team_id = NULL, roster_team_id = NULL
             WHERE id = $1`,
            [txn.dropped_player_id],
            { label: `Drop ${txn.dropped_player_name} to FA` },
          );
          rosterChanges++;
        } catch (err) {
          errors.push(`Failed to drop ${txn.dropped_player_name}: ${String(err)}`);
        }
      }

      // ── Insert transaction record ──
      const hashParts = [
        txn.transaction_date,
        txn.transaction_time ?? "",
        txn.manager_name.toLowerCase(),
        txn.added_player_name?.toLowerCase() ?? "",
        txn.dropped_player_name?.toLowerCase() ?? "",
      ];
      const dedupHash = hashParts.join("|");

      // Build timestamp from date + time
      let txnTs: string | null = null;
      if (txn.transaction_time) {
        txnTs = `${txn.transaction_date} ${txn.transaction_time}`;
      }

      try {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_waiver_transactions
           (season, transaction_date, transaction_time, transaction_ts, manager_name, team_id,
            added_player_name, added_player_position, added_player_nfl_team, added_player_id,
            dropped_player_name, dropped_player_position, dropped_player_nfl_team, dropped_player_id,
            dedup_hash)
           VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (dedup_hash) DO NOTHING`,
          [
            season,
            txn.transaction_date,
            txn.transaction_time,
            txnTs,
            txn.manager_name,
            txn.team_id,
            txn.added_player_name,
            txn.added_player_position,
            txn.added_player_nfl_team,
            addedPlayerId,
            txn.dropped_player_name,
            txn.dropped_player_position,
            txn.dropped_player_nfl_team,
            txn.dropped_player_id,
            dedupHash,
          ],
          { label: `Record transaction: ${txn.manager_name} +${txn.added_player_name ?? ""} -${txn.dropped_player_name ?? ""}` },
        );
        applied++;
      } catch (err) {
        errors.push(`Failed to record transaction: ${String(err)}`);
      }
    }

    ctx.log.info("Waiver transactions applied", { applied, skippedDuplicates, playersCreated, rosterChanges });

    return {
      applied,
      skippedDuplicates,
      playersCreated,
      rosterChanges,
      errors,
    };
  },
});
