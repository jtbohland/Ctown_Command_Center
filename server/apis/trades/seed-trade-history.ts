import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Team ID mapping
const T: Record<string, number> = {
  JT: 1, Tyler: 2, Brooke: 3, Carson: 4, AJ: 5,
  Adam: 6, Drew: 7, Erik: 8, Jimmy: 9, Chuck: 10, Jordan: 11,
};

interface TradeData {
  number: number;
  season: string;
  date: string;
  teamA: number;
  teamB: number;
  period: string;
  assetsFromA: Array<{ type: "player" | "pick"; name?: string; position?: string; year?: number; round?: number; pickNum?: number }>;
  assetsFromB: Array<{ type: "player" | "pick"; name?: string; position?: string; year?: number; round?: number; pickNum?: number }>;
}

function player(name: string, position?: string): { type: "player"; name: string; position?: string } {
  return { type: "player", name, position };
}

function pick(year: number, round: number, pickNum?: number): { type: "pick"; year: number; round: number; pickNum?: number } {
  return { type: "pick", year, round, pickNum };
}

// Convert pick number to round (11 teams per round)
function pickToRound(pickNum: number): number {
  return Math.ceil(pickNum / 11);
}

export default api({
  name: "SeedTradeHistory",
  description: "Seeds all historical trade data from 2024-25 and 2025-26 seasons.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    batch: z.enum(["2024-25", "2025-26"]).default("2025-26"),
  }),

  output: z.object({
    message: z.string(),
    tradesInserted: z.number(),
  }),

  async run(ctx, { batch }) {
    const trades = batch === "2024-25" ? get2024Trades() : get2025Trades();

    // Clear existing trades for this season
    await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_trades WHERE season = $1`,
      [batch],
      { label: `Clear existing ${batch} trades` }
    );

    let tradesInserted = 0;

    for (const trade of trades) {
      // Insert trade header
      const tradeRows = await ctx.integrations.apps_db.query(
        `INSERT INTO ffwr_trades (trade_number, season, trade_date, team_a_id, team_b_id, status, period)
         VALUES ($1, $2, $3, $4, $5, 'accepted', $6)
         RETURNING id`,
        z.object({ id: z.coerce.number() }),
        [trade.number, trade.season, trade.date, trade.teamA, trade.teamB, trade.period],
        { label: `Insert trade #${trade.number}` }
      );

      const tradeId = tradeRows[0].id;

      // Insert assets from Team A
      for (const asset of trade.assetsFromA) {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, player_name, player_position, pick_year, pick_round, pick_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tradeId, trade.teamA, asset.type, asset.name ?? null, asset.position ?? null, asset.year ?? null, asset.round ?? null, asset.pickNum ?? null],
          { label: `Asset from team A: ${asset.name ?? `R${asset.round} pick`}` }
        );
      }

      // Insert assets from Team B
      for (const asset of trade.assetsFromB) {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, player_name, player_position, pick_year, pick_round, pick_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tradeId, trade.teamB, asset.type, asset.name ?? null, asset.position ?? null, asset.year ?? null, asset.round ?? null, asset.pickNum ?? null],
          { label: `Asset from team B: ${asset.name ?? `R${asset.round} pick`}` }
        );
      }

      tradesInserted++;
    }

    return {
      message: `Seeded ${tradesInserted} trades for ${batch} season`,
      tradesInserted,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════
// 2025-26 SEASON TRADES (Trades #8–#45)
// In-season: #8–#32 (Aug 23 – Nov 12, 2025)
// Off-season: #33–#45 (Mar 2026 – Aug 2026)
// ═══════════════════════════════════════════════════════════════════
function get2025Trades(): TradeData[] {
  return [
    // #8: 9/4/2025 — JT ↔ Adam
    { number: 8, season: "2025-26", date: "2025-09-04", teamA: T.JT, teamB: T.Adam, period: "in-season",
      assetsFromA: [player("Jakobi Meyers", "WR"), pick(2026, 6, 58)],
      assetsFromB: [player("Najee Harris", "RB"), player("Cooper Kupp", "WR"), pick(2026, 8, 88)] },

    // #9: 9/16/2025 — Chuck ↔ JT
    { number: 9, season: "2025-26", date: "2025-09-16", teamA: T.Chuck, teamB: T.JT, period: "in-season",
      assetsFromA: [player("Deebo Samuel", "WR"), pick(2026, 8, 82)],
      assetsFromB: [player("Matthew Golden", "WR"), pick(2026, 3, 31)] },

    // #10: 9/24/2025 — Erik ↔ Drew
    { number: 10, season: "2025-26", date: "2025-09-24", teamA: T.Erik, teamB: T.Drew, period: "in-season",
      assetsFromA: [player("Tre Tucker", "WR"), pick(2026, 7, 76), pick(2026, 10, 101)],
      assetsFromB: [player("Jerry Jeudy", "WR"), pick(2026, 5, 49), pick(2026, 5, 49)] },
    // Note: Drew's trade is Round 5 (acquired from Erik) — simplifying to pick 49

    // #11: 9/30/2025 — JT ↔ AJ
    { number: 11, season: "2025-26", date: "2025-09-30", teamA: T.JT, teamB: T.AJ, period: "in-season",
      assetsFromA: [player("Cooper Kupp", "WR"), player("Nick Chubb", "RB"), pick(2026, 5, 53), pick(2026, 7, 75), pick(2027, 1)],
      assetsFromB: [player("Courtland Sutton", "WR"), player("Elic Ayomanor", "WR"), pick(2026, 9, 91), pick(2026, 11, 113), pick(2027, 7), pick(2027, 9), pick(2027, 6)] },

    // #12: 9/30/2025 — AJ ↔ Erik
    { number: 12, season: "2025-26", date: "2025-09-30", teamA: T.AJ, teamB: T.Erik, period: "in-season",
      assetsFromA: [player("Tucker Kraft", "TE"), pick(2026, 10, 108)],
      assetsFromB: [pick(2026, 5, 54)] },

    // #13: 10/1/2025 — Carson ↔ Tyler
    { number: 13, season: "2025-26", date: "2025-10-01", teamA: T.Carson, teamB: T.Tyler, period: "in-season",
      assetsFromA: [player("Brandon Aiyuk", "WR"), pick(2026, 4, 37)],
      assetsFromB: [player("Stefon Diggs", "WR"), pick(2026, 10, 109)] },

    // #14: 10/1/2025 — Brooke ↔ Tyler
    { number: 14, season: "2025-26", date: "2025-10-01", teamA: T.Brooke, teamB: T.Tyler, period: "in-season",
      assetsFromA: [player("Jaylen Waddle", "WR"), pick(2026, 7, 72)],
      assetsFromB: [player("Alvin Kamara", "RB"), pick(2026, 5, 46)] },

    // #15: 10/1/2025 — Adam ↔ Erik
    { number: 15, season: "2025-26", date: "2025-10-01", teamA: T.Adam, teamB: T.Erik, period: "in-season",
      assetsFromA: [player("Jakobi Meyers", "WR"), pick(2026, 6, 66)],
      assetsFromB: [player("Travis Etienne", "RB"), pick(2026, 10, 101)] },

    // #16: 10/6/2025 — JT ↔ Carson
    { number: 16, season: "2025-26", date: "2025-10-06", teamA: T.JT, teamB: T.Carson, period: "in-season",
      assetsFromA: [player("Theo Johnson", "TE"), pick(2027, 3)],
      assetsFromB: [player("Rhamondre Stevenson", "RB"), pick(2027, 7)] },

    // #17: 10/6/2025 — JT ↔ Jimmy
    { number: 17, season: "2025-26", date: "2025-10-06", teamA: T.JT, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Jameson Williams", "WR"), player("Jordan Mason", "RB"), player("Tony Pollard", "RB"), player("Isiah Davis", "RB"), pick(2026, 8, 80)],
      assetsFromB: [player("Chuba Hubbard", "RB"), player("Javonte Williams", "RB"), pick(2026, 10, 107)] },

    // #18: 10/18/2025 — JT ↔ Jimmy
    { number: 18, season: "2025-26", date: "2025-10-18", teamA: T.JT, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Omarion Hampton", "RB"), player("Tony Pollard", "RB"), player("Isiah Davis", "RB"), pick(2026, 8, 80)],
      assetsFromB: [player("Jameson Williams", "WR"), player("Jordan Mason", "RB"), player("Javonte Williams", "RB")] },

    // #19: 10/22/2025 — Chuck ↔ Carson
    { number: 19, season: "2025-26", date: "2025-10-22", teamA: T.Chuck, teamB: T.Carson, period: "in-season",
      assetsFromA: [player("De'Von Achane", "RB"), player("TJ Hockenson", "TE"), pick(2026, 5, 51)],
      assetsFromB: [player("Brian Thomas Jr.", "WR"), player("Treyveon Henderson", "RB"), pick(2026, 1, 8)] },

    // #20: 10/22/2025 — Chuck ↔ JT
    { number: 20, season: "2025-26", date: "2025-10-22", teamA: T.Chuck, teamB: T.JT, period: "in-season",
      assetsFromA: [player("Saquon Barkley", "RB"), player("Breece Hall", "RB"), player("Patrick Mahomes", "QB"), pick(2026, 4, 38)],
      assetsFromB: [player("Tetairoa McMillan", "WR"), player("Jameson Williams", "WR"), player("Elic Ayomanor", "WR"), pick(2026, 1, 9), pick(2026, 1, 2)] },

    // #21: 11/2/2025 — AJ ↔ Jimmy
    { number: 21, season: "2025-26", date: "2025-11-02", teamA: T.AJ, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Kyle Monangai", "RB"), pick(2026, 8, 86)],
      assetsFromB: [pick(2026, 4)] },

    // #22: 11/3/2025 — Chuck ↔ Jimmy
    { number: 22, season: "2025-26", date: "2025-11-03", teamA: T.Chuck, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Rico Dowdle", "RB"), pick(2026, 6, 60), pick(2026, 7, 73)],
      assetsFromB: [pick(2026, 2, 19)] },

    // #23: 11/5/2025 — JT ↔ Erik
    { number: 23, season: "2025-26", date: "2025-11-05", teamA: T.JT, teamB: T.Erik, period: "in-season",
      assetsFromA: [player("Breece Hall", "RB"), pick(2026, 4, 46), pick(2026, 8, 82)],
      assetsFromB: [player("Chris Olave", "WR"), pick(2026, 3, 32), pick(2026, 10, 101)] },

    // #24: 11/6/2025 — JT ↔ Brooke
    { number: 24, season: "2025-26", date: "2025-11-06", teamA: T.JT, teamB: T.Brooke, period: "in-season",
      assetsFromA: [player("Chris Olave", "WR"), pick(2026, 8, 82)],
      assetsFromB: [pick(2026, 1)] },

    // #25: 11/6/2025 — JT ↔ Tyler
    { number: 25, season: "2025-26", date: "2025-11-06", teamA: T.JT, teamB: T.Tyler, period: "in-season",
      assetsFromA: [pick(2026, 1), pick(2026, 3, 31)],
      assetsFromB: [player("Jaylen Waddle", "WR"), pick(2026, 9, 90), pick(2026, 11, 112)] },

    // #26: 11/8/2025 — JT ↔ Jimmy
    { number: 26, season: "2025-26", date: "2025-11-08", teamA: T.JT, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Mark Andrews", "TE"), pick(2027, 4), pick(2027, 7)],
      assetsFromB: [player("Jacorey Croskey-Merritt", "RB"), pick(2027, 8), pick(2027, 10)] },

    // #27: 11/11/2025 — AJ ↔ Jordan
    { number: 27, season: "2025-26", date: "2025-11-11", teamA: T.AJ, teamB: T.Jordan, period: "in-season",
      assetsFromA: [player("Tyjae Spears", "RB"), pick(2026, 7, 69)],
      assetsFromB: [pick(2026, 6, 56)] },

    // #28: 11/12/2025 — Chuck ↔ Jordan
    { number: 28, season: "2025-26", date: "2025-11-12", teamA: T.Chuck, teamB: T.Jordan, period: "in-season",
      assetsFromA: [player("Jameson Williams", "WR"), player("Dak Prescott", "QB"), pick(2026, 7, 73)],
      assetsFromB: [pick(2026, 2, 12)] },

    // #29: 11/12/2025 — Chuck ↔ Drew
    { number: 29, season: "2025-26", date: "2025-11-12", teamA: T.Chuck, teamB: T.Drew, period: "in-season",
      assetsFromA: [player("Elic Ayomanor", "WR"), pick(2026, 11, 117)],
      assetsFromB: [player("Tank Bigsby", "RB"), pick(2026, 7, 71)] },

    // #30: 11/12/2025 — Erik ↔ Tyler
    { number: 30, season: "2025-26", date: "2025-11-12", teamA: T.Erik, teamB: T.Tyler, period: "in-season",
      assetsFromA: [player("Tucker Kraft", "TE"), pick(2026, 1, 10), pick(2027, 2)],
      assetsFromB: [player("Tee Higgins", "WR"), pick(2026, 8, 87), pick(2027, 3)] },

    // #31: 11/12/2025 — Carson ↔ Tyler
    { number: 31, season: "2025-26", date: "2025-11-12", teamA: T.Carson, teamB: T.Tyler, period: "in-season",
      assetsFromA: [pick(2026, 5, 52), pick(2027, 5), pick(2027, 10)],
      assetsFromB: [player("D'Andre Swift", "RB"), pick(2026, 7, 72)] },

    // #32: 11/12/2025 — JT ↔ Jimmy
    { number: 32, season: "2025-26", date: "2025-11-12", teamA: T.JT, teamB: T.Jimmy, period: "in-season",
      assetsFromA: [player("Deebo Samuel", "WR"), player("Chuba Hubbard", "RB"), pick(2026, 4)],
      assetsFromB: [player("Jordan Addison", "WR"), player("Mark Andrews", "TE"), pick(2026, 8, 85)] },

    // ═══ OFF-SEASON 2026 ═══════════════════════════════════════════

    // #33: 3/11/2026 — Brooke ↔ Jimmy
    { number: 33, season: "2025-26", date: "2026-03-11", teamA: T.Brooke, teamB: T.Jimmy, period: "off-season",
      assetsFromA: [player("Jaxon Smith-Njigba", "WR"), pick(2026, 4, 39)],
      assetsFromB: [player("Omarion Hampton", "RB"), player("Emeka Egbuka", "WR"), pick(2026, 1)] },

    // #34: 6/2/2026 — Chuck ↔ Carson
    { number: 34, season: "2025-26", date: "2026-06-02", teamA: T.Chuck, teamB: T.Carson, period: "off-season",
      assetsFromA: [pick(2026, 2, 19)],
      assetsFromB: [player("Colston Loveland", "TE"), pick(2026, 6, 59)] },

    // #35: 6/9/2026 — Chuck ↔ Jordan
    { number: 35, season: "2025-26", date: "2026-06-09", teamA: T.Chuck, teamB: T.Jordan, period: "off-season",
      assetsFromA: [player("Treyveon Henderson", "RB"), pick(2026, 2, 16)],
      assetsFromB: [player("Kenneth Walker III", "RB"), pick(2026, 7, 69)] },

    // #36: 6/10/2026 — Carson ↔ Jordan
    { number: 36, season: "2025-26", date: "2026-06-10", teamA: T.Carson, teamB: T.Jordan, period: "off-season",
      assetsFromA: [player("Nico Collins", "WR"), pick(2026, 9, 96)],
      assetsFromB: [pick(2026, 1, 11)] },

    // #37: 7/21/2026 — Jordan ↔ JT
    { number: 37, season: "2025-26", date: "2026-07-21", teamA: T.Jordan, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Tyler Warren", "TE"), player("Luther Burden III", "WR"), pick(2026, 7, 73)],
      assetsFromB: [player("Jaylen Waddle", "WR"), pick(2026, 8, 85)] },

    // #38: 7/22/2026 — Adam ↔ JT
    { number: 38, season: "2025-26", date: "2026-07-22", teamA: T.Adam, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Derrick Henry", "RB"), pick(2026, 4, 44), pick(2026, 7, 67)],
      assetsFromB: [player("Saquon Barkley", "RB"), pick(2026, 8, 88), pick(2026, 9, 90)] },

    // #39: 7/22/2026 — Brooke ↔ JT
    { number: 39, season: "2025-26", date: "2026-07-22", teamA: T.Brooke, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Lamar Jackson", "QB"), player("Zay Flowers", "WR"), pick(2026, 3, 28), pick(2026, 6, 61), pick(2027, 6)],
      assetsFromB: [player("James Cook III", "RB"), pick(2026, 9, 91), pick(2026, 10, 107), pick(2027, 2)] },

    // #40: 7/25/2026 — Erik ↔ Chuck
    { number: 40, season: "2025-26", date: "2026-07-25", teamA: T.Erik, teamB: T.Chuck, period: "off-season",
      assetsFromA: [player("AJ Brown", "WR"), pick(2026, 5, 49), pick(2026, 8, 87)],
      assetsFromB: [pick(2026, 1, 12), pick(2026, 6, 59)] },

    // #41: 7/25/2026 — Carson ↔ Chuck
    { number: 41, season: "2025-26", date: "2026-07-25", teamA: T.Carson, teamB: T.Chuck, period: "off-season",
      assetsFromA: [pick(2026, 3, 30)],
      assetsFromB: [player("Garrett Wilson", "WR"), pick(2026, 7, 71)] },

    // #42: 7/26/2026 — Brooke ↔ Tyler
    { number: 42, season: "2025-26", date: "2026-07-26", teamA: T.Brooke, teamB: T.Tyler, period: "off-season",
      assetsFromA: [player("Kyren Williams", "RB"), pick(2027, 7)],
      assetsFromB: [pick(2027, 2)] },

    // #43: 7/26/2026 — Jordan ↔ Tyler
    { number: 43, season: "2025-26", date: "2026-07-26", teamA: T.Jordan, teamB: T.Tyler, period: "off-season",
      assetsFromA: [player("George Pickens", "WR"), pick(2026, 11, 121)],
      assetsFromB: [pick(2026, 3, 24)] },

    // #44: 7/26/2026 — Jordan ↔ Jimmy
    { number: 44, season: "2025-26", date: "2026-07-26", teamA: T.Jordan, teamB: T.Jimmy, period: "off-season",
      assetsFromA: [pick(2026, 3, 33), pick(2026, 4, 34)],
      assetsFromB: [player("Ladd McConkey", "WR"), pick(2026, 5, 48), pick(2026, 6, 60)] },

    // #45: 8/4/2026 — AJ ↔ JT
    { number: 45, season: "2025-26", date: "2026-08-04", teamA: T.AJ, teamB: T.JT, period: "off-season",
      assetsFromA: [pick(2026, 4, 42), pick(2026, 5, 54), pick(2026, 11, 120)],
      assetsFromB: [player("Luther Burden III", "WR"), pick(2026, 6, 61)] },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// 2024-25 SEASON TRADES (Trades #6–#34)
// In-season: #6–#17 (Sep 14 – Nov 13, 2024)
// Off-season: #18–#34 (Jan 2025 – Aug 2025)
// ═══════════════════════════════════════════════════════════════════
function get2024Trades(): TradeData[] {
  return [
    // #6: 9/14/2024 — AJ ↔ Erik
    { number: 6, season: "2024-25", date: "2024-09-14", teamA: T.AJ, teamB: T.Erik, period: "in-season",
      assetsFromA: [pick(2025, 4, 36), pick(2026, 5)],
      assetsFromB: [player("Jordan Mason", "RB"), pick(2025, 12, 127)] },

    // #7: 10/17/2024 — JT ↔ Adam
    { number: 7, season: "2024-25", date: "2024-10-17", teamA: T.JT, teamB: T.Adam, period: "in-season",
      assetsFromA: [pick(2025, 5, 51), pick(2025, 10, 107)],
      assetsFromB: [player("Javonte Williams", "RB")] },

    // #8: 11/4/2024 — JT ↔ Brooke
    { number: 8, season: "2024-25", date: "2024-11-04", teamA: T.JT, teamB: T.Brooke, period: "in-season",
      assetsFromA: [player("Darnell Mooney", "WR"), pick(2025, 9, 90)],
      assetsFromB: [player("Xavier Worthy", "WR"), pick(2025, 2, 16)] },

    // #9: 11/5/2024 — JT ↔ Tyler
    { number: 9, season: "2024-25", date: "2024-11-05", teamA: T.JT, teamB: T.Tyler, period: "in-season",
      assetsFromA: [player("Cade Otton", "TE"), pick(2025, 9, 95)],
      assetsFromB: [pick(2025, 7, 67)] },

    // #10: 11/6/2024 — JT ↔ Carson
    { number: 10, season: "2024-25", date: "2024-11-06", teamA: T.JT, teamB: T.Carson, period: "in-season",
      assetsFromA: [player("CJ Stroud", "QB"), pick(2025, 11, 117)],
      assetsFromB: [pick(2025, 7, 72)] },

    // #11: 11/10/2024 — Chuck ↔ Erik
    { number: 11, season: "2024-25", date: "2024-11-10", teamA: T.Chuck, teamB: T.Erik, period: "in-season",
      assetsFromA: [pick(2025, 3, 32)],
      assetsFromB: [player("Najee Harris", "RB"), pick(2025, 7, 71)] },

    // #12: 11/10/2024 — Brooke ↔ Erik
    { number: 12, season: "2024-25", date: "2024-11-10", teamA: T.Brooke, teamB: T.Erik, period: "in-season",
      assetsFromA: [player("Chris Godwin", "WR"), pick(2025, 6, 59)],
      assetsFromB: [player("Tony Pollard", "RB"), pick(2025, 9, 92)] },

    // #13: 11/13/2024 — Adam ↔ Erik
    { number: 13, season: "2024-25", date: "2024-11-13", teamA: T.Adam, teamB: T.Erik, period: "in-season",
      assetsFromA: [pick(2025, 10, 100)],
      assetsFromB: [player("David Njoku", "TE"), pick(2025, 12, 136)] },

    // #14: 11/13/2024 — JT ↔ Carson
    { number: 14, season: "2024-25", date: "2024-11-13", teamA: T.JT, teamB: T.Carson, period: "in-season",
      assetsFromA: [player("Jonathan Taylor", "RB"), pick(2025, 7, 72), pick(2025, 7, 73)],
      assetsFromB: [pick(2025, 1, 2), pick(2025, 9, 94)] },

    // #15: 11/13/2024 — Chuck ↔ Erik
    { number: 15, season: "2024-25", date: "2024-11-13", teamA: T.Chuck, teamB: T.Erik, period: "in-season",
      assetsFromA: [pick(2025, 9, 98)],
      assetsFromB: [player("DeAndre Swift", "RB"), pick(2025, 12, 115)] },

    // #16: 11/13/2024 — Jimmy ↔ Erik
    { number: 16, season: "2024-25", date: "2024-11-13", teamA: T.Jimmy, teamB: T.Erik, period: "in-season",
      assetsFromA: [pick(2025, 9, 99)],
      assetsFromB: [player("Kyler Murray", "QB"), pick(2025, 11, 114)] },

    // #17: 11/13/2024 — Adam ↔ Carson
    { number: 17, season: "2024-25", date: "2024-11-13", teamA: T.Adam, teamB: T.Carson, period: "in-season",
      assetsFromA: [pick(2025, 6, 63)],
      assetsFromB: [player("Bucky Irving", "RB"), pick(2025, 11, 113)] },

    // ═══ OFF-SEASON 2025 ═══════════════════════════════════════════

    // #18: 1/7/2025 — AJ ↔ Jordan
    { number: 18, season: "2024-25", date: "2025-01-07", teamA: T.AJ, teamB: T.Jordan, period: "off-season",
      assetsFromA: [pick(2025, 1, 10), pick(2025, 12)],
      assetsFromB: [pick(2025, 4, 47), player("Marvin Harrison Jr.", "WR")] },

    // #19: 1/10/2025 — Chuck ↔ Carson
    { number: 19, season: "2024-25", date: "2025-01-10", teamA: T.Chuck, teamB: T.Carson, period: "off-season",
      assetsFromA: [pick(2025, 1, 6)],
      assetsFromB: [player("De'Von Achane", "RB"), pick(2025, 7, 73)] },

    // #20: 1/10/2025 — Carson ↔ Jordan
    { number: 20, season: "2024-25", date: "2025-01-10", teamA: T.Carson, teamB: T.Jordan, period: "off-season",
      assetsFromA: [pick(2025, 4, 47), pick(2025, 7, 75)],
      assetsFromB: [player("Jonathan Taylor", "RB")] },

    // #21: 1/11/2025 — Erik ↔ Drew
    { number: 21, season: "2024-25", date: "2025-01-11", teamA: T.Erik, teamB: T.Drew, period: "off-season",
      assetsFromA: [player("Jalen Hurts", "QB"), pick(2025, 12, 130)],
      assetsFromB: [pick(2025, 8, 84), pick(2025, 9, 93)] },

    // #22: 5/22/2025 — JT ↔ Adam
    { number: 22, season: "2024-25", date: "2025-05-22", teamA: T.JT, teamB: T.Adam, period: "off-season",
      assetsFromA: [pick(2025, 3, 24)],
      assetsFromB: [player("Zay Flowers", "WR"), pick(2025, 12, 132)] },

    // #23: 5/22/2025 — JT ↔ Carson
    { number: 23, season: "2024-25", date: "2025-05-22", teamA: T.JT, teamB: T.Carson, period: "off-season",
      assetsFromA: [pick(2025, 3, 25)],
      assetsFromB: [player("Joe Mixon", "RB"), pick(2025, 9, 94)] },

    // #24: 5/29/2025 — Chuck ↔ Jimmy
    { number: 24, season: "2024-25", date: "2025-05-29", teamA: T.Chuck, teamB: T.Jimmy, period: "off-season",
      assetsFromA: [player("Puka Nacua", "WR"), pick(2025, 12, 120)],
      assetsFromB: [player("Saquon Barkley", "RB"), pick(2025, 2, 18)] },

    // #25: 7/23/2025 — Adam ↔ Brooke
    { number: 25, season: "2024-25", date: "2025-07-23", teamA: T.Adam, teamB: T.Brooke, period: "off-season",
      assetsFromA: [pick(2025, 1, 8), pick(2025, 3, 24), pick(2026, 1)],
      assetsFromB: [player("Amon-Ra St. Brown", "WR"), pick(2025, 8, 81), pick(2025, 9, 92), pick(2026, 8)] },

    // #26: 7/23/2025 — Adam ↔ Jimmy
    { number: 26, season: "2024-25", date: "2025-07-23", teamA: T.Adam, teamB: T.Jimmy, period: "off-season",
      assetsFromA: [player("Chase Brown", "RB"), pick(2025, 2, 19), pick(2025, 5, 56)],
      assetsFromB: [pick(2025, 1, 7), pick(2025, 4, 42)] },

    // #27: 7/24/2025 — Chuck ↔ JT
    { number: 27, season: "2024-25", date: "2025-07-24", teamA: T.Chuck, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Jayden Daniels", "QB"), player("Breece Hall", "RB"), pick(2026, 1), pick(2026, 4)],
      assetsFromB: [player("Ladd McConkey", "WR"), pick(2025, 2, 20), pick(2025, 11, 117)] },
    // Note: this trade also sent to Jimmy (Garrett Wilson to Chuck, 20 to JT, etc.) but simplifying main parties

    // #28: 7/29/2025 — Adam ↔ JT
    { number: 28, season: "2024-25", date: "2025-07-29", teamA: T.Adam, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Davante Adams", "WR"), pick(2025, 4, 42), pick(2025, 12, 125)],
      assetsFromB: [pick(2025, 2, 20), pick(2025, 9, 94)] },

    // #29: 8/4/2025 — Erik ↔ Drew
    { number: 29, season: "2024-25", date: "2025-08-04", teamA: T.Erik, teamB: T.Drew, period: "off-season",
      assetsFromA: [pick(2025, 3, 27), pick(2025, 3, 32), pick(2025, 9, 98), pick(2026, 5), pick(2026, 9)],
      assetsFromB: [player("AJ Brown", "WR"), pick(2025, 8, 84), pick(2025, 10, 108), pick(2025, 11, 122)] },

    // #30: 8/20/2025 — Adam ↔ Tyler
    { number: 30, season: "2024-25", date: "2025-08-20", teamA: T.Adam, teamB: T.Tyler, period: "off-season",
      assetsFromA: [player("Bucky Irving", "RB")],
      assetsFromB: [player("Derrick Henry", "RB")] },

    // #31: 8/21/2025 — AJ ↔ JT
    { number: 31, season: "2024-25", date: "2025-08-21", teamA: T.AJ, teamB: T.JT, period: "off-season",
      assetsFromA: [player("Jameson Williams", "WR"), pick(2026, 11)],
      assetsFromB: [pick(2026, 2)] },

    // #32: 8/22/2025 — Drew ↔ Chuck
    { number: 32, season: "2024-25", date: "2025-08-22", teamA: T.Drew, teamB: T.Chuck, period: "off-season",
      assetsFromA: [pick(2025, 4, 35)],
      assetsFromB: [player("DK Metcalf", "WR"), pick(2025, 5, 54)] },

    // #33: 8/23/2025 — Carson ↔ JT (draft day)
    { number: 33, season: "2024-25", date: "2025-08-23", teamA: T.Carson, teamB: T.JT, period: "off-season",
      assetsFromA: [pick(2025, 3, 25), pick(2025, 3, 28)],
      assetsFromB: [pick(2025, 2, 16), pick(2025, 4, 42)] },

    // #34: 8/23/2025 — Drew ↔ Erik (draft day)
    { number: 34, season: "2024-25", date: "2025-08-23", teamA: T.Drew, teamB: T.Erik, period: "off-season",
      assetsFromA: [pick(2025, 5, 54), pick(2025, 7, 77)],
      assetsFromB: [pick(2025, 5, 48), pick(2025, 10, 108)] },
  ];
}
