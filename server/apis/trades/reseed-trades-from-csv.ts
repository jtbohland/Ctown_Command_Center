import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ── Team name → ID mapping ──────────────────────────────────────────
const TEAM_MAP: Record<string, number> = {
  JT: 1, Tyler: 2, Brooke: 3, Carson: 4, AJ: 5,
  Adam: 6, "Adam R.": 6, Drew: 7, Erik: 8, Jimmy: 9,
  Chuck: 10, Jordan: 11,
};

// ── CSV league_season → DB season format ────────────────────────────
// CSV uses end-year (2019 = the 2018-19 season), DB uses "YYYY-YY" span
function csvSeasonToDbSeason(csvSeason: string): string {
  const year = parseInt(csvSeason, 10);
  const prevYear = year - 1;
  const shortYear = String(year).slice(2);
  return `${prevYear}-${shortYear}`;
}

// ── Asset parsing ───────────────────────────────────────────────────
interface ParsedAsset {
  type: "player" | "pick";
  playerName?: string;
  pickRound?: number;
  pickNumber?: number;  // overall pick number
  pickYear?: number;    // for future picks
}

/**
 * Determines if an asset string is a player name or a draft pick reference.
 * Returns a ParsedAsset with structured data.
 *
 * Pick format variations encountered in CSV:
 *   "Round 1 (1)"          → round 1, overall 1
 *   "Round 6"              → round 6, no overall
 *   "27 (Rd 3)"            → overall 27, round 3
 *   "27"                   → overall 27 (bare number)
 *   "(2022 Rd 1)"          → future pick: year 2022, round 1
 *   "2022 Round 4"         → future pick: year 2022, round 4
 *   "2022 (Rd 12)"         → future pick: year 2022, round 12
 *   "2024 Round 6"         → future pick
 *   "2027 Rd 11"           → future pick
 *   "Round 4 (40)"         → round 4, overall 40
 *   "Round 12 (114)"       → round 12, overall 114
 */
function parseAsset(raw: string, tradeSeason: string): ParsedAsset | null {
  const s = raw.trim();
  if (!s) return null;

  // Skip marker text from 3-way trades
  const lower = s.toLowerCase();
  if (
    lower.includes("trades away") ||
    lower === "b"  // stray "B" in 2020-027
  ) {
    return null;
  }

  // Strip "(to TeamName)" and "(via TeamName)" suffixes from 3-way trade annotations
  const cleaned = s.replace(/\s*\((?:to|via)\s+\w+\)\s*$/i, "").trim();
  if (!cleaned) return null;

  // ── Future pick: "(YYYY Rd N)" ──
  const futureParenMatch = cleaned.match(/^\((\d{4})\s+Rd\s+(\d+)\)$/i);
  if (futureParenMatch) {
    return { type: "pick", pickYear: parseInt(futureParenMatch[1]), pickRound: parseInt(futureParenMatch[2]) };
  }

  // ── Future pick: "YYYY Round N" or "YYYY (Rd N)" or "YYYY Rd N" ──
  const futureMatch = cleaned.match(/^(\d{4})\s+(?:Round|Rd|\(Rd)\s*(\d+)\)?$/i);
  if (futureMatch) {
    return { type: "pick", pickYear: parseInt(futureMatch[1]), pickRound: parseInt(futureMatch[2]) };
  }

  // ── "Round N (overall)" — e.g. "Round 1 (1)" ──
  const roundOverallMatch = cleaned.match(/^Round\s+(\d+)\s*\((\d+)\)$/i);
  if (roundOverallMatch) {
    return {
      type: "pick",
      pickRound: parseInt(roundOverallMatch[1]),
      pickNumber: parseInt(roundOverallMatch[2]),
    };
  }

  // ── "Round N" — no overall ──
  const roundOnlyMatch = cleaned.match(/^Round\s+(\d+)$/i);
  if (roundOnlyMatch) {
    return { type: "pick", pickRound: parseInt(roundOnlyMatch[1]) };
  }

  // ── "NN (Rd N)" — overall first, round in parens ──
  const overallRdMatch = cleaned.match(/^(\d+)\s*\(Rd\s*(\d+)\)$/i);
  if (overallRdMatch) {
    return {
      type: "pick",
      pickNumber: parseInt(overallRdMatch[1]),
      pickRound: parseInt(overallRdMatch[2]),
    };
  }

  // ── "NN (Rd N) (via Team)" — overall with round and via annotation ──
  const overallViaMatch = cleaned.match(/^(\d+)\s*\(Rd\s*(\d+)\)\s*\(via\s+\w+\)$/i);
  if (overallViaMatch) {
    return {
      type: "pick",
      pickNumber: parseInt(overallViaMatch[1]),
      pickRound: parseInt(overallViaMatch[2]),
    };
  }

  // ── "(YYYY Rd N)N" — malformed future pick e.g. "(2022 Rd 1)9" ──
  const malformedFuture = cleaned.match(/^\((\d{4})\s+Rd\s+(\d+)\)\d*$/i);
  if (malformedFuture) {
    return { type: "pick", pickYear: parseInt(malformedFuture[1]), pickRound: parseInt(malformedFuture[2]) };
  }

  // ── Future pick: "YYYY 1st" / "YYYY 6th" — ordinal round format ──
  const futureOrdinalMatch = cleaned.match(/^(\d{4})\s+(\d+)(?:st|nd|rd|th)$/i);
  if (futureOrdinalMatch) {
    return { type: "pick", pickYear: parseInt(futureOrdinalMatch[1]), pickRound: parseInt(futureOrdinalMatch[2]) };
  }

  // ── Bare number — overall pick ──
  // Must be a standalone number (1-150 range for typical fantasy picks)
  const bareNumberMatch = cleaned.match(/^(\d+)$/);
  if (bareNumberMatch) {
    const num = parseInt(bareNumberMatch[1]);
    // Numbers 1-150 are pick references; larger numbers unlikely
    if (num >= 1 && num <= 150) {
      // Derive round from overall pick (11 teams, 10 rounds typical, but up to 13)
      const round = Math.ceil(num / 11);
      return { type: "pick", pickNumber: num, pickRound: round };
    }
  }

  // ── "Exp. Rights to Player" — special asset, treat as player ──
  if (lower.startsWith("exp. rights to")) {
    return { type: "player", playerName: cleaned };
  }

  // ── Everything else is a player name ──
  return { type: "player", playerName: cleaned };
}

// ── Period detection ────────────────────────────────────────────────
// Rough heuristic: in-season = Sept-Nov, off-season = rest
function detectPeriod(tradeDate: string): string {
  const month = parseInt(tradeDate.slice(5, 7), 10);
  if (month >= 9 && month <= 11) return "in-season";
  return "off-season";
}

// ── CSV parsing ─────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── 3-way trade detection ───────────────────────────────────────────
// Some rows encode 3-way trades by putting "(to TeamName)" suffixes
// in asset columns, with marker text like "Carson Trades Away"
function isThreeWayMarker(s: string): boolean {
  return /trades\s+away/i.test(s.trim());
}

export default api({
  name: "ReseedTradesFromCsv",
  description: "Wipes and re-seeds all trades from the clean CSV.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvData: z.string(),
    dryRun: z.boolean().optional(),
    appendMode: z.boolean().optional(),
  }),

  output: z.object({
    message: z.string(),
    tradesInserted: z.number(),
    assetsInserted: z.number(),
    parseErrors: z.array(z.string()),
    seasonBreakdown: z.record(z.number()),
  }),

  async run(ctx, { csvData, dryRun, appendMode }) {
    const lines = csvData.split("\n").filter((l) => l.trim());
    const header = lines[0];
    const dataLines = lines.slice(1);

    const parseErrors: string[] = [];
    const seasonBreakdown: Record<string, number> = {};

    // ── Parse all rows ──────────────────────────────────────────────
    interface TradeRow {
      dbSeason: string;
      tradeDate: string;
      tradeNumberInSeason: number;
      period: string;
      teams: Array<{ teamId: number; assets: ParsedAsset[] }>;
      tradeId: string;
      isThreeWay: boolean;
    }

    const tradeRows: TradeRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const fields = parseCSVLine(dataLines[i]);
      const lineNum = i + 2; // 1-indexed, +1 for header

      const csvSeason = fields[0]?.trim();
      let tradeYear = fields[1]?.trim();
      let tradeDate = fields[2]?.trim();
      const tradeId = fields[3]?.trim() || `${csvSeason}-${String(i + 1).padStart(3, "0")}`;
      const tradeNumStr = fields[4]?.trim();
      const tradeNumber = parseInt(tradeNumStr || "0", 10);

      if (!csvSeason) {
        parseErrors.push(`Line ${lineNum}: missing league_season`);
        continue;
      }

      const dbSeason = csvSeasonToDbSeason(csvSeason);

      // Fix the known 2205 date bug
      if (tradeYear === "2205") {
        tradeDate = tradeDate.replace("2205", "2025");
      }

      // Validate/fix date
      if (!tradeDate || tradeDate.length < 10) {
        tradeDate = `${csvSeason}-01-01`; // fallback
      }

      const period = detectPeriod(tradeDate);

      // ── Parse team columns ──────────────────────────────────────
      // team_1 at index 5, team_1_asset_1..7 at 6..12
      // team_2 at index 13, team_2_asset_1..7 at 14..20
      // team_3 at index 21, team_3_asset_1..7 at 22..28
      const teams: Array<{ teamId: number; assets: ParsedAsset[] }> = [];
      const teamIndices = [
        { nameIdx: 5, assetStart: 6, assetEnd: 12 },
        { nameIdx: 13, assetStart: 14, assetEnd: 20 },
        { nameIdx: 21, assetStart: 22, assetEnd: 28 },
      ];

      let isThreeWay = false;

      for (const { nameIdx, assetStart, assetEnd } of teamIndices) {
        const teamName = fields[nameIdx]?.trim();
        if (!teamName) continue;

        const teamId = TEAM_MAP[teamName];
        if (!teamId) {
          parseErrors.push(`Line ${lineNum}: unknown team "${teamName}"`);
          continue;
        }

        const assets: ParsedAsset[] = [];
        for (let j = assetStart; j <= assetEnd; j++) {
          const raw = fields[j]?.trim();
          if (!raw) continue;

          // Check for 3-way marker
          if (isThreeWayMarker(raw)) {
            isThreeWay = true;
            continue;
          }

          const parsed = parseAsset(raw, dbSeason);
          if (parsed) {
            assets.push(parsed);
          }
        }

        if (assets.length > 0) {
          teams.push({ teamId, assets });
        }
      }

      if (teams.length < 2) {
        parseErrors.push(`Line ${lineNum} (${tradeId}): found fewer than 2 teams with assets`);
        continue;
      }

      // Count season
      seasonBreakdown[dbSeason] = (seasonBreakdown[dbSeason] || 0) + 1;

      tradeRows.push({
        dbSeason,
        tradeDate,
        tradeNumberInSeason: tradeNumber,
        period,
        teams,
        tradeId,
        isThreeWay,
      });
    }

    if (dryRun) {
      return {
        message: `Dry run: parsed ${tradeRows.length} trades from ${dataLines.length} CSV rows.`,
        tradesInserted: tradeRows.length,
        assetsInserted: tradeRows.reduce((sum, t) => sum + t.teams.reduce((s, tm) => s + tm.assets.length, 0), 0),
        parseErrors,
        seasonBreakdown,
      };
    }

    // ── Wipe existing data (skip if appendMode) ────────────────────
    if (!appendMode) {
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_trade_assets`,
        undefined,
        { label: "Wipe trade assets" }
      );
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_trades`,
        undefined,
        { label: "Wipe trades" }
      );
    }

    // ── Insert trades ───────────────────────────────────────────────
    let totalAssets = 0;

    for (const row of tradeRows) {
      // For 2-team trades: team_a = teams[0], team_b = teams[1]
      // For 3-way trades: we decompose into pairwise trades
      // But the DB schema only supports 2-team trades (team_a_id, team_b_id)
      // For 3-way: insert as team_a vs team_b (first two), assets stay correct
      // because assets use from_team_id to track who gave what

      const teamA = row.teams[0].teamId;
      const teamB = row.teams[1].teamId;

      // Insert trade
      const tradeResult = await ctx.integrations.apps_db.query(
        `INSERT INTO ffwr_trades (trade_number, season, trade_date, team_a_id, team_b_id, status, period, notes)
         VALUES ($1, $2, $3, $4, $5, 'accepted', $6, $7)
         RETURNING id`,
        z.object({ id: z.coerce.number() }),
        [
          row.tradeNumberInSeason,
          row.dbSeason,
          row.tradeDate,
          teamA,
          teamB,
          row.period,
          row.isThreeWay ? `3-way trade (${row.tradeId})` : null,
        ],
        { label: `Insert trade ${row.tradeId}` }
      );

      const newTradeId = tradeResult[0].id;

      // Insert assets for ALL teams (from_team_id tracks who gave what)
      for (const team of row.teams) {
        for (const asset of team.assets) {
          if (asset.type === "player") {
            await ctx.integrations.apps_db.execute(
              `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, player_name)
               VALUES ($1, $2, 'player', $3)`,
              [newTradeId, team.teamId, asset.playerName],
              { label: `Asset: ${asset.playerName}` }
            );
          } else {
            await ctx.integrations.apps_db.execute(
              `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, pick_year, pick_round, pick_number)
               VALUES ($1, $2, 'pick', $3, $4, $5)`,
              [newTradeId, team.teamId, asset.pickYear || null, asset.pickRound || null, asset.pickNumber || null],
              { label: `Asset: Rd ${asset.pickRound} pick` }
            );
          }
          totalAssets++;
        }
      }
    }

    return {
      message: `Re-seeded ${tradeRows.length} trades with ${totalAssets} assets across ${Object.keys(seasonBreakdown).length} seasons.`,
      tradesInserted: tradeRows.length,
      assetsInserted: totalAssets,
      parseErrors,
      seasonBreakdown,
    };
  },
});
