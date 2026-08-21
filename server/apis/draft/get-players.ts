import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// z.null() MUST come first: z.coerce.number() coerces null→0, which silently
// destroys NULL semantics (e.g. players without a positional_rank sort to the top).
const numOrNull = z.union([z.null(), z.coerce.number()]);

const PlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: numOrNull,
  dynasty_rank: numOrNull,
  positional_rank: numOrNull,
  implied_team_points: numOrNull,
  bye_week: numOrNull,
  draft_rank: numOrNull,
  draft_tier: numOrNull,
  upside: z.string().nullable(),
  bust: z.string().nullable(),
  sos: z.string().nullable(),
  age: numOrNull,
  dynasty_tier: numOrNull,
  is_keeper: z.coerce.boolean(),
  keeper_team_id: numOrNull,
  is_drafted: z.coerce.boolean(),
  drafted_team_id: numOrNull,
  drafted_round: numOrNull,
  drafted_pick: numOrNull,
  tags: z.string().nullable(),
  is_write_in: z.coerce.boolean(),
});

export default api({
  name: "GetPlayers",
  description: "Returns all players with tags, rankings, and draft status.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    players: z.array(PlayerSchema),
  }),

  async run(ctx) {
    const players = await ctx.integrations.apps_db.query(
      `SELECT
        p.id, p.name, p.position, p.nfl_team,
        p.adp_rank, p.dynasty_rank, p.positional_rank, p.implied_team_points,
        p.bye_week, p.draft_rank, p.draft_tier, p.upside, p.bust, p.sos,
        p.age, p.dynasty_tier,
        CASE WHEN p.is_keeper THEN true ELSE false END as is_keeper, p.keeper_team_id,
        CASE WHEN p.is_drafted THEN true ELSE false END as is_drafted, p.drafted_team_id, p.drafted_round, p.drafted_pick,
        COALESCE(p.is_write_in, false) as is_write_in,
        STRING_AGG(pt.tag, ',' ORDER BY pt.tag) as tags
      FROM ffwr_players p
      LEFT JOIN ffwr_player_tags pt ON pt.player_id = p.id
      GROUP BY p.id
      ORDER BY COALESCE(p.adp_rank, 9999), p.name`,
      PlayerSchema,
      undefined,
      { label: "Fetch all players with tags" }
    );

    return { players };
  },
});
