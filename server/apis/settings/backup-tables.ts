import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Permissive row schema — allows any column structure
const AnyRowSchema = z.record(z.unknown());

const TABLES_TO_BACKUP = [
  "ffwr_trades",
  "ffwr_trade_assets",
  "ffwr_draft_capital",
  "ffwr_historical_adp",
  "ffwr_players",
  "ffwr_teams",
  "ffwr_player_scores",
  "ffwr_canonical_players",
  "ffwr_verdict_snapshots",
  "ffwr_league_records",
  "ffwr_waiver_transactions",
] as const;

export default api({
  name: "BackupTables",
  description: "Creates a point-in-time JSON backup of all critical ffwr_* tables.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    label: z.string().default("pre_phase1_audit"),
  }),

  output: z.object({
    backupId: z.string(),
    tablesBackedUp: z.number(),
    totalRows: z.number(),
    details: z.array(
      z.object({
        table: z.string(),
        rows: z.number(),
        status: z.string(),
      })
    ),
  }),

  async run(ctx, { label }) {
    requireAdmin(ctx, "create a database backup");

    const db = ctx.integrations.apps_db;

    // 1. Create the backup snapshots table if it doesn't exist
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_backup_snapshots (
        id SERIAL PRIMARY KEY,
        backup_id TEXT NOT NULL,
        backup_label TEXT NOT NULL,
        table_name TEXT NOT NULL,
        row_count INT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create backup snapshots table" }
    );

    // 2. Generate a unique backup ID
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const details: { table: string; rows: number; status: string }[] = [];
    let totalRows = 0;

    // 3. For each table, read all rows and store as JSONB
    for (const tableName of TABLES_TO_BACKUP) {
      try {
        const rows = await db.query(
          `SELECT * FROM ${tableName}`,
          AnyRowSchema,
          undefined,
          { label: `Read ${tableName}` }
        );

        const rowCount = rows.length;
        totalRows += rowCount;

        // Store the backup — data is the full array of rows as JSONB
        await db.execute(
          `INSERT INTO ffwr_backup_snapshots (backup_id, backup_label, table_name, row_count, data)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [backupId, label, tableName, rowCount, JSON.stringify(rows)],
          { label: `Backup ${tableName} (${rowCount} rows)` }
        );

        details.push({ table: tableName, rows: rowCount, status: "✅ backed up" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Table might not exist — that's ok, record it
        if (msg.includes("does not exist")) {
          details.push({ table: tableName, rows: 0, status: "⏭️ table does not exist" });
        } else {
          details.push({ table: tableName, rows: 0, status: `❌ error: ${msg}` });
        }
      }
    }

    return {
      backupId,
      tablesBackedUp: details.filter((d) => d.status.startsWith("✅")).length,
      totalRows,
      details,
    };
  },
});
