import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const COLS_PER_ROW = 15;

const TradeVerdictRow = z.object({
  id: z.coerce.number(),
  trade_number: z.coerce.number().nullable(),
  season: z.string().nullable(),
  verdict_label: z.string().nullable(),
  verdict_emoji: z.string().nullable(),
  verdict_severity: z.string().nullable(),
  winner_team_id: z.coerce.number().nullable(),
  pct_difference: z.string().nullable(),
  team_a_total: z.string().nullable(),
  team_b_total: z.string().nullable(),
  team_c_total: z.string().nullable(),
  confidence: z.string().nullable(),
  valuation_complete: z.boolean().nullable(),
});

export default api({
  name: "TakeVerdictSnapshot",
  description: "Appends an immutable snapshot of all trade verdicts to ffwr_verdict_snapshots.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    runType: z.string().default("manual"),
  }),

  output: z.object({
    runId: z.string(),
    tradesSnapshotted: z.number(),
    runType: z.string(),
    message: z.string(),
  }),

  async run(ctx, { runType }) {
    const runId = crypto.randomUUID();

    // Read all current trade verdicts
    const trades = await ctx.integrations.apps_db.query(
      `SELECT id, trade_number, season,
              verdict_label, verdict_emoji, verdict_severity,
              winner_team_id, pct_difference,
              team_a_total, team_b_total, team_c_total,
              confidence, valuation_complete
       FROM ffwr_trades
       WHERE valuation_complete = true
       ORDER BY id`,
      TradeVerdictRow,
      undefined,
      { label: "Read all trade verdicts for snapshot" }
    );

    if (trades.length === 0) {
      return {
        runId,
        tradesSnapshotted: 0,
        runType,
        message: "No completed trade verdicts found to snapshot.",
      };
    }

    // Build batch INSERT — 15 columns per row
    const params: (string | number | boolean | null)[] = [];
    const tuples: string[] = [];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const base = i * COLS_PER_ROW + 1;
      const placeholders = Array.from({ length: COLS_PER_ROW }, (_, j) => `$${base + j}`).join(", ");
      tuples.push(`(${placeholders})`);
      params.push(
        runId,
        runType,
        t.id,
        t.trade_number,
        t.season,
        t.verdict_label,
        t.verdict_emoji,
        t.verdict_severity,
        t.winner_team_id,
        t.pct_difference != null ? Number(t.pct_difference) : null,
        t.team_a_total != null ? Number(t.team_a_total) : null,
        t.team_b_total != null ? Number(t.team_b_total) : null,
        t.team_c_total != null ? Number(t.team_c_total) : null,
        t.confidence,
        t.valuation_complete ?? false,
      );
    }

    const insertSql = `
      INSERT INTO ffwr_verdict_snapshots (
        run_id, run_type, trade_id, trade_number, season,
        verdict_label, verdict_emoji, verdict_severity,
        winner_team_id, pct_difference,
        team_a_total, team_b_total, team_c_total,
        confidence, valuation_complete
      ) VALUES ${tuples.join(",\n")}
    `;

    await ctx.integrations.apps_db.execute(
      insertSql,
      params,
      { label: `Insert ${trades.length} verdict snapshot rows (run: ${runId.slice(0, 8)})` }
    );

    return {
      runId,
      tradesSnapshotted: trades.length,
      runType,
      message: `Snapshot complete: ${trades.length} trade verdicts frozen as run ${runId.slice(0, 8)}… (type: ${runType})`,
    };
  },
});
