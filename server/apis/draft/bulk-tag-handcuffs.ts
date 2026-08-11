import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const HANDCUFF_RBS = [
  "Tyler Allgeier", "Brian Robinson Jr.", "Justice Hill", "Ray Davis",
  "Jonathon Brooks", "Kyle Monangai", "Samaje Perine", "Dylan Sampson",
  "Jaydon Blue", "RJ Harvey", "Isiah Pacheco", "MarShawn Lloyd",
  "Woody Marks", "DJ Giddens", "Chris Rodriguez Jr.", "Emmett Johnson",
  "Kimani Vidal", "Blake Corum", "Mike Washington Jr.", "Ollie Gordon II",
  "Aaron Jones Sr.", "Rhamondre Stevenson", "Alvin Kamara", "Tyrone Tracy Jr.",
  "Braelon Allen", "Tank Bigsby", "Jaylen Warren", "Emanuel Wilson",
  "Jordan James", "Kenny Gainwell", "Tyjae Spears", "Jacory Croskey-Merritt",
];

export default api({
  name: "BulkTagHandcuffs",
  description: "Tags all 32 handcuff RBs with the handcuff tag.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    tagged: z.number(),
  }),

  async run(ctx) {
    // Build a single INSERT with ON CONFLICT to skip already-tagged players
    const placeholders = HANDCUFF_RBS.map((_, i) => `$${i + 1}`).join(", ");

    const result = await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_player_tags (player_id, tag)
       SELECT id, 'handcuff' FROM ffwr_players
       WHERE position = 'RB' AND name IN (${placeholders})
       ON CONFLICT (player_id, tag) DO NOTHING`,
      HANDCUFF_RBS,
      { label: "Bulk-tag handcuff RBs" }
    );

    return { tagged: result.rowCount ?? 0 };
  },
});
