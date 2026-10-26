import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const UpdatedTeamSchema = z.object({
  id: z.coerce.number(),
  team_name: z.string(),
  emoji: z.string().nullable(),
});

/**
 * Updates a team's display name and emoji in ffwr_teams.
 * Historical records (ffwr_historical_draft_picks, etc.) keep the name they were recorded with.
 */
export default api({
  name: "UpdateTeam",
  description: "Updates a team's name and emoji.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    teamId: z.number().int().positive(),
    teamName: z.string().trim().min(1, "Team name is required").max(60, "Team name is too long"),
    emoji: z.string().trim().max(16, "Emoji is too long").nullable(),
  }),

  output: z.object({
    team: UpdatedTeamSchema,
  }),

  async run(ctx, { teamId, teamName, emoji }) {
    requireAdmin(ctx, "edit a team");

    // Prevent two teams sharing a name — waiver + upload matching relies on unique names
    const dupes = await ctx.integrations.apps_db.query(
      `SELECT id, team_name, emoji FROM ffwr_teams
       WHERE LOWER(team_name) = LOWER($1) AND id <> $2
       LIMIT 1`,
      UpdatedTeamSchema,
      [teamName, teamId],
      { label: "Check for duplicate team name" },
    );
    if (dupes.length > 0) {
      throw new Error(`Another team is already named "${teamName}".`);
    }

    // UPDATE ... RETURNING via query() — reliable row confirmation + read-back in one call
    const rows = await ctx.integrations.apps_db.query(
      `UPDATE ffwr_teams SET team_name = $1, emoji = $2
       WHERE id = $3
       RETURNING id, team_name, emoji`,
      UpdatedTeamSchema,
      [teamName, emoji && emoji.length > 0 ? emoji : null, teamId],
      { label: "Update team name + emoji" },
    );
    if (rows.length === 0) {
      throw new Error(`Team ${teamId} not found.`);
    }

    return { team: rows[0] };
  },
});
