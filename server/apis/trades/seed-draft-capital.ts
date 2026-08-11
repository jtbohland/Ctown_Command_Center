import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Team ID mapping (manager name -> team_id)
const TEAM_IDS: Record<string, number> = {
  JT: 1, Tyler: 2, Brooke: 3, Carson: 4, AJ: 5,
  Adam: 6, Drew: 7, Erik: 8, Jimmy: 9, Chuck: 10, Jordan: 11,
};

export default api({
  name: "SeedDraftCapital",
  description: "Seeds 2027 and 2028 draft capital ownership into ffwr_draft_capital.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
    rowsInserted: z.number(),
  }),

  async run(ctx) {
    // Clear existing data
    await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_draft_capital WHERE year IN (2027, 2028)`,
      undefined,
      { label: "Clear existing draft capital" }
    );

    // ── 2028: Clean slate — everyone owns all their picks ────────────
    const rows2028: string[] = [];
    for (let teamId = 1; teamId <= 11; teamId++) {
      for (let round = 1; round <= 11; round++) {
        rows2028.push(`(2028, ${round}, ${teamId}, ${teamId})`);
      }
    }

    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_draft_capital (year, round, original_team_id, current_team_id)
       VALUES ${rows2028.join(", ")}`,
      undefined,
      { label: "Seed 2028 draft capital (all clean)" }
    );

    // ── 2027: Parse traded picks from uploaded data ──────────────────
    // Format: Each team starts with 11 picks (rounds 1-11)
    // Traded picks change current_team_id
    
    // Start with everyone owning their own picks
    const ownership2027: Array<{ round: number; originalTeamId: number; currentTeamId: number }> = [];
    for (let teamId = 1; teamId <= 11; teamId++) {
      for (let round = 1; round <= 11; round++) {
        ownership2027.push({ round, originalTeamId: teamId, currentTeamId: teamId });
      }
    }

    // Apply 2027 trades based on uploaded CSV data:
    // Trade 1 (from 2025 season): Drew R10 → Erik, Erik R11 → Drew
    applyTrade(ownership2027, 10, TEAM_IDS.Drew, TEAM_IDS.Erik);
    applyTrade(ownership2027, 11, TEAM_IDS.Erik, TEAM_IDS.Drew);

    // Trade 2 (9/30/2025): AJ R1 → JT, JT R7 → AJ, JT R9 → AJ, JT R6 → AJ
    applyTrade(ownership2027, 1, TEAM_IDS.JT, TEAM_IDS.AJ); // JT sends his R1 to AJ
    applyTrade(ownership2027, 7, TEAM_IDS.AJ, TEAM_IDS.JT); // AJ sends his R7 to JT
    applyTrade(ownership2027, 9, TEAM_IDS.AJ, TEAM_IDS.JT); // AJ sends his R9 to JT
    applyTrade(ownership2027, 6, TEAM_IDS.JT, TEAM_IDS.AJ); // JT sends his R6 to AJ

    // Trade 3 (10/6/2025): JT R3 → Carson, Carson R7 → JT
    applyTrade(ownership2027, 3, TEAM_IDS.JT, TEAM_IDS.Carson);
    applyTrade(ownership2027, 7, TEAM_IDS.Carson, TEAM_IDS.JT);

    // Trade 4 (11/8/2025): JT R4 → Jimmy (via Tyler), Jimmy R8 → JT, JT R10 → Jimmy (acquired from Carson in T3)
    applyTrade(ownership2027, 4, TEAM_IDS.JT, TEAM_IDS.Jimmy);
    applyTrade(ownership2027, 8, TEAM_IDS.Jimmy, TEAM_IDS.JT);
    // JT's acquired Carson R7 → Tyler (from the chain: Carson→JT→Tyler in pick 68)
    // Actually this is: JT R7 (Carson's, acquired in T3) → Tyler
    // Let me re-check: Trade 4 references say JT R4 → Tyler, Jimmy R8 → JT
    // And JT R7** (acquired from Carson) → Jimmy R10
    // Correcting: 
    applyTrade(ownership2027, 4, TEAM_IDS.JT, TEAM_IDS.Tyler); // JT R4 to Tyler

    // Trade 5 (11/12/2025): Tyler R3 → Erik, Erik R2 → Tyler
    applyTrade(ownership2027, 3, TEAM_IDS.Tyler, TEAM_IDS.Erik);
    applyTrade(ownership2027, 2, TEAM_IDS.Erik, TEAM_IDS.Tyler);

    // Trade 6 (11/12/2025): Tyler R10 → Carson, Carson R5 → Tyler
    applyTrade(ownership2027, 10, TEAM_IDS.Tyler, TEAM_IDS.Carson);
    applyTrade(ownership2027, 5, TEAM_IDS.Carson, TEAM_IDS.Tyler);

    // Trade 7 (7/22/2026): JT R2 → Brooke, Brooke R6 → JT
    applyTrade(ownership2027, 2, TEAM_IDS.JT, TEAM_IDS.Brooke);
    applyTrade(ownership2027, 6, TEAM_IDS.Brooke, TEAM_IDS.JT);

    // Trade 8 (7/26/2026): Tyler R2 → Brooke (acquired from Erik in T5), Brooke R7 → Tyler (Brooke's R11 actually)
    // Correcting from CSV: Tyler gives his R2 (acquired from Erik in T5) to Brooke
    // Brooke gives R7 to Tyler
    applyTrade(ownership2027, 2, TEAM_IDS.Tyler, TEAM_IDS.Brooke); // Tyler's R2 (was Erik's) to Brooke — but Tyler already sent Erik's R2 to... 
    // Wait - Tyler acquired Erik's R2 in Trade 5. Now Tyler sends it to Brooke in Trade 8.
    // The ownership chain: Erik R2 → Tyler (T5), then that pick (now Tyler's) → needs to go to Brooke
    // But our model tracks original_team_id. Erik's R2 is now owned by Tyler. We need to transfer it again.
    // Let me use a different approach - find the pick by current owner and transfer
    transferPick(ownership2027, 2, TEAM_IDS.Tyler, TEAM_IDS.Brooke); // Tyler's acquired R2 to Brooke
    applyTrade(ownership2027, 7, TEAM_IDS.Brooke, TEAM_IDS.Tyler); // Brooke's R7 to Tyler

    // Now insert all 2027 ownership
    const rows2027 = ownership2027.map(
      (p) => `(2027, ${p.round}, ${p.originalTeamId}, ${p.currentTeamId})`
    );

    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_draft_capital (year, round, original_team_id, current_team_id)
       VALUES ${rows2027.join(", ")}`,
      undefined,
      { label: "Seed 2027 draft capital" }
    );

    const totalRows = rows2028.length + rows2027.length;
    return { 
      message: `Seeded draft capital: ${rows2028.length} picks for 2028, ${rows2027.length} picks for 2027`,
      rowsInserted: totalRows,
    };
  },
});

// Transfer a pick: find the pick owned by fromTeamId in the given round and change to toTeamId
function applyTrade(
  ownership: Array<{ round: number; originalTeamId: number; currentTeamId: number }>,
  round: number,
  fromOriginalTeamId: number,
  toTeamId: number
) {
  const pick = ownership.find(
    (p) => p.round === round && p.originalTeamId === fromOriginalTeamId
  );
  if (pick) {
    pick.currentTeamId = toTeamId;
  }
}

// Transfer a pick by current owner (for picks that have already been traded once)
function transferPick(
  ownership: Array<{ round: number; originalTeamId: number; currentTeamId: number }>,
  round: number,
  currentOwnerId: number,
  toTeamId: number
) {
  const pick = ownership.find(
    (p) => p.round === round && p.currentTeamId === currentOwnerId
  );
  if (pick) {
    pick.currentTeamId = toTeamId;
  }
}
