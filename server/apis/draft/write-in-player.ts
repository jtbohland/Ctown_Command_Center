import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const CreatedPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  bye_week: z.coerce.number().nullable(),
});

export default api({
  name: "WriteInPlayer",
  description: "Creates a write-in player not on the ADP board.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    playerName: z.string().min(1),
    position: z.enum(["QB", "RB", "WR", "TE"]),
    nflTeam: z.string().min(2),
    byeWeek: z.number().nullable(),
  }),

  output: z.object({
    player: CreatedPlayerSchema,
    message: z.string(),
  }),

  async run(ctx, { playerName, position, nflTeam, byeWeek }) {
    requireAdmin(ctx, "create a write-in player");

    const normalized = normalizePlayerName(playerName);

    // Check for existing player with same normalized name
    const existing = await ctx.integrations.apps_db.query(
      "SELECT id, name FROM ffwr_players WHERE LOWER(REPLACE(name, '.', '')) = LOWER(REPLACE($1, '.', '')) LIMIT 1",
      z.object({ id: z.coerce.number(), name: z.string() }),
      [normalized],
      { label: "Check for duplicate player" },
    );

    if (existing.length > 0) {
      throw new Error(
        `Player "${normalized}" already exists (id: ${existing[0].id}). Use the existing player instead.`,
      );
    }

    // Insert the write-in player
    const rows = await ctx.integrations.apps_db.query(
      `INSERT INTO ffwr_players (name, position, nfl_team, bye_week, is_write_in, is_drafted, is_keeper)
       VALUES ($1, $2, $3, $4, TRUE, FALSE, FALSE)
       RETURNING id, name, position, nfl_team, bye_week`,
      CreatedPlayerSchema,
      [normalized, position, nflTeam, byeWeek],
      { label: "Insert write-in player" },
    );

    ctx.log.info("Write-in player created", {
      id: rows[0].id,
      name: normalized,
      position,
      nflTeam,
    });

    return {
      player: rows[0],
      message: `Created write-in player: ${normalized} (${position}, ${nflTeam})`,
    };
  },
});
