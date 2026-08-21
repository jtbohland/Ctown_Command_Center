import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Lightweight API to stamp a verdict onto an existing ffwr_trades row.
 * Called after EvaluateTrade returns, so the verdict appears instantly
 * in The Verdicts tab and any historical queries.
 */
export default api({
  name: "PersistTradeVerdict",
  description: "Writes computed verdict columns to an existing trade record.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    tradeId: z.number(),
    verdictLabel: z.string(),
    verdictEmoji: z.string(),
    verdictSeverity: z.string(),
    winnerTeamId: z.number().nullable(),
    pctDifference: z.number(),
    teamATotal: z.number(),
    teamBTotal: z.number(),
    teamCTotal: z.number().nullable(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, input) {
    requireAdmin(ctx, "persist a trade verdict");

    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_trades
       SET verdict_label = $1,
           verdict_emoji = $2,
           verdict_severity = $3,
           winner_team_id = $4,
           pct_difference = $5,
           team_a_total = $6,
           team_b_total = $7,
           team_c_total = $8,
           valuation_complete = true,
           confidence = 'auto'
       WHERE id = $9`,
      [
        input.verdictLabel,
        input.verdictEmoji,
        input.verdictSeverity,
        input.winnerTeamId,
        input.pctDifference,
        input.teamATotal,
        input.teamBTotal,
        input.teamCTotal,
        input.tradeId,
      ],
      { label: `Persist verdict for trade #${input.tradeId}` },
    );

    return { success: true };
  },
});
