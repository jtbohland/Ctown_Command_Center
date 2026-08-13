import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Name Normalization (mirrors client/lib/trade-utils.ts) ──
const NAME_CORRECTIONS: Record<string, string> = {
  "patrick maholmes": "patrick mahomes",
  "patrick maholmes ii": "patrick mahomes",
};

function normalizeName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_CORRECTIONS[n] ?? n;
}

// ─── Schemas ─────────────────────────────────────────────────
const AdpRowSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season_count: z.coerce.number(),
});

const ActualsRowSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season_count: z.coerce.number(),
});

const RookieRowSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  nfl_draft_year: z.coerce.number(),
});

const TradeAssetRowSchema = z.object({
  player_name: z.string(),
});

const CountSchema = z.object({ cnt: z.coerce.number() });

// Represents a merged identity from all sources
interface PlayerIdentity {
  canonicalName: string;      // Best display name (prefer ADP/Actuals name)
  normalizedName: string;     // Output of normalizeName()
  position: string | null;    // From sources with position data
  nflDraftYear: number | null;
  inAdp: boolean;
  inActuals: boolean;
  inRookies: boolean;
  inTrades: boolean;
  aliases: string[];          // All distinct original names
  matchStatus: string;        // exact | alias | ambiguous
  adpSeasons: number;
  actualsSeasons: number;
}

export default api({
  name: "BuildPlayerIdentityMap",
  description: "Cross-references all 4 player data sources and populates ffwr_canonical_players.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    dryRun: z.boolean().optional(),
  }),

  output: z.object({
    totalPlayers: z.number(),
    byMatchStatus: z.record(z.number()),
    bySource: z.object({
      adpOnly: z.number(),
      actualsOnly: z.number(),
      rookiesOnly: z.number(),
      tradesOnly: z.number(),
      multiSource: z.number(),
    }),
    sampleAmbiguous: z.array(z.object({
      normalizedName: z.string(),
      positions: z.array(z.string()),
      sources: z.array(z.string()),
    })),
    committed: z.boolean(),
  }),

  async run(ctx, { dryRun }) {
    const isDryRun = dryRun ?? true;

    // ── Step 1: Pull distinct players from each source ──

    // ADP: player_name + position, with season counts
    const adpPlayers = await ctx.integrations.apps_db.query(
      `SELECT player_name, position, COUNT(DISTINCT season) as season_count
       FROM ffwr_historical_adp
       GROUP BY player_name, position
       ORDER BY player_name`,
      AdpRowSchema,
      undefined,
      { label: "Fetch distinct ADP players" }
    );
    ctx.log.info(`ADP: ${adpPlayers.length} distinct player+position combos`);

    // Actuals: player_name + position, with season counts
    const actualsPlayers = await ctx.integrations.apps_db.query(
      `SELECT player_name, position, COUNT(DISTINCT season) as season_count
       FROM ffwr_season_actuals
       GROUP BY player_name, position
       ORDER BY player_name`,
      ActualsRowSchema,
      undefined,
      { label: "Fetch distinct Actuals players" }
    );
    ctx.log.info(`Actuals: ${actualsPlayers.length} distinct player+position combos`);

    // Rookies: player_name + position + draft year
    const rookiePlayers = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT player_name, position, nfl_draft_year
       FROM ffwr_rookie_classes
       ORDER BY player_name`,
      RookieRowSchema,
      undefined,
      { label: "Fetch distinct Rookie players" }
    );
    ctx.log.info(`Rookies: ${rookiePlayers.length} distinct players`);

    // Trade Assets: player_name only (no position)
    const tradePlayers = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT player_name
       FROM ffwr_trade_assets
       WHERE asset_type = 'player' AND player_name IS NOT NULL
       ORDER BY player_name`,
      TradeAssetRowSchema,
      undefined,
      { label: "Fetch distinct trade asset players" }
    );
    ctx.log.info(`Trade assets: ${tradePlayers.length} distinct player names`);

    // ── Step 2: Build identity map keyed by normalized name ──
    // Key: normalizedName → PlayerIdentity
    // For position-less sources (trades), we merge into any existing identity
    // that shares the same normalized name.
    const identityMap = new Map<string, PlayerIdentity>();

    // Helper to get or create an identity
    function getOrCreate(norm: string, originalName: string, position: string | null): PlayerIdentity {
      // Key includes position when available to handle same-name different-position cases
      const key = position ? `${norm}||${position.toUpperCase()}` : norm;
      
      // First check for an exact key match
      let identity = identityMap.get(key);
      if (identity) {
        if (!identity.aliases.includes(originalName)) {
          identity.aliases.push(originalName);
        }
        return identity;
      }

      // For position-less lookups, try to find any existing identity with same normalizedName
      if (!position) {
        for (const [k, v] of identityMap) {
          if (v.normalizedName === norm) {
            if (!v.aliases.includes(originalName)) {
              v.aliases.push(originalName);
            }
            return v;
          }
        }
      }

      // Create new identity
      identity = {
        canonicalName: originalName,
        normalizedName: norm,
        position: position?.toUpperCase() ?? null,
        nflDraftYear: null,
        inAdp: false,
        inActuals: false,
        inRookies: false,
        inTrades: false,
        aliases: [originalName],
        matchStatus: "exact",
        adpSeasons: 0,
        actualsSeasons: 0,
      };
      identityMap.set(key, identity);
      return identity;
    }

    // Process ADP (highest fidelity — use as canonical name source)
    for (const row of adpPlayers) {
      const norm = normalizeName(row.player_name);
      const identity = getOrCreate(norm, row.player_name, row.position);
      identity.inAdp = true;
      identity.adpSeasons = Math.max(identity.adpSeasons, row.season_count);
      // Prefer ADP name as canonical
      identity.canonicalName = row.player_name;
    }

    // Process Actuals
    for (const row of actualsPlayers) {
      const norm = normalizeName(row.player_name);
      const identity = getOrCreate(norm, row.player_name, row.position);
      identity.inActuals = true;
      identity.actualsSeasons = Math.max(identity.actualsSeasons, row.season_count);
      // If not yet in ADP, use actuals name as canonical
      if (!identity.inAdp) {
        identity.canonicalName = row.player_name;
      }
    }

    // Process Rookies
    for (const row of rookiePlayers) {
      const norm = normalizeName(row.player_name);
      const identity = getOrCreate(norm, row.player_name, row.position);
      identity.inRookies = true;
      identity.nflDraftYear = row.nfl_draft_year;
    }

    // Process Trade Assets (no position data — merge into existing identities)
    for (const row of tradePlayers) {
      const norm = normalizeName(row.player_name);
      const identity = getOrCreate(norm, row.player_name, null);
      identity.inTrades = true;
    }

    // ── Step 3: Detect ambiguous matches ──
    // Players where trade assets match multiple position-specific identities
    const normToPositions = new Map<string, Set<string>>();
    for (const identity of identityMap.values()) {
      if (identity.position) {
        if (!normToPositions.has(identity.normalizedName)) {
          normToPositions.set(identity.normalizedName, new Set());
        }
        normToPositions.get(identity.normalizedName)!.add(identity.position);
      }
    }

    // Mark match status
    for (const identity of identityMap.values()) {
      const positions = normToPositions.get(identity.normalizedName);
      if (positions && positions.size > 1 && !identity.position) {
        // Same normalized name matches multiple positions (e.g., player changed position)
        identity.matchStatus = "ambiguous";
      } else if (identity.aliases.length > 1) {
        identity.matchStatus = "alias";
      } else {
        identity.matchStatus = "exact";
      }
    }

    // ── Step 4: Compute stats ──
    const allIdentities = Array.from(identityMap.values());
    const byMatchStatus: Record<string, number> = {};
    let adpOnly = 0, actualsOnly = 0, rookiesOnly = 0, tradesOnly = 0, multiSource = 0;

    for (const id of allIdentities) {
      byMatchStatus[id.matchStatus] = (byMatchStatus[id.matchStatus] ?? 0) + 1;
      const sourceCount = [id.inAdp, id.inActuals, id.inRookies, id.inTrades].filter(Boolean).length;
      if (sourceCount > 1) {
        multiSource++;
      } else if (id.inAdp) {
        adpOnly++;
      } else if (id.inActuals) {
        actualsOnly++;
      } else if (id.inRookies) {
        rookiesOnly++;
      } else if (id.inTrades) {
        tradesOnly++;
      }
    }

    // Collect sample ambiguous entries
    const sampleAmbiguous = allIdentities
      .filter(id => id.matchStatus === "ambiguous")
      .slice(0, 20)
      .map(id => ({
        normalizedName: id.normalizedName,
        positions: Array.from(normToPositions.get(id.normalizedName) ?? []),
        sources: [
          id.inAdp ? "ADP" : null,
          id.inActuals ? "Actuals" : null,
          id.inRookies ? "Rookies" : null,
          id.inTrades ? "Trades" : null,
        ].filter(Boolean) as string[],
      }));

    ctx.log.info(`Identity map built: ${allIdentities.length} identities`);
    ctx.log.info(`Match status: ${JSON.stringify(byMatchStatus)}`);
    ctx.log.info(`Sources: adpOnly=${adpOnly} actualsOnly=${actualsOnly} rookiesOnly=${rookiesOnly} tradesOnly=${tradesOnly} multi=${multiSource}`);

    // ── Step 5: Commit to DB (unless dry run) ──
    let committed = false;
    if (!isDryRun) {
      // Check table exists
      const tableCheck = await ctx.integrations.apps_db.query(
        `SELECT COUNT(*) as cnt FROM information_schema.tables
         WHERE table_name = 'ffwr_canonical_players'`,
        CountSchema,
        undefined,
        { label: "Check canonical_players table exists" }
      );
      if (tableCheck[0].cnt === 0) {
        throw new Error("ffwr_canonical_players table does not exist. Run InitCanonicalPlayers first.");
      }

      // Clear existing data for fresh rebuild
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_canonical_players`,
        undefined,
        { label: "Clear existing canonical players" }
      );

      // Insert in batches of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < allIdentities.length; i += BATCH_SIZE) {
        const batch = allIdentities.slice(i, i + BATCH_SIZE);
        const values: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const id of batch) {
          values.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3},` +
            ` $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7},` +
            ` $${paramIdx + 8}::jsonb, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11})`
          );
          params.push(
            id.canonicalName,           // 1: canonical_name
            id.normalizedName,          // 2: normalized_name
            id.position,                // 3: position
            id.nflDraftYear,            // 4: nfl_draft_year
            id.inAdp,                   // 5: in_adp
            id.inActuals,               // 6: in_actuals
            id.inRookies,               // 7: in_rookies
            id.inTrades,                // 8: in_trades
            JSON.stringify(id.aliases), // 9: aliases
            id.matchStatus,             // 10: match_status
            id.adpSeasons,              // 11: adp_seasons
            id.actualsSeasons,          // 12: actuals_seasons
          );
          paramIdx += 12;
        }

        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_canonical_players
            (canonical_name, normalized_name, position, nfl_draft_year,
             in_adp, in_actuals, in_rookies, in_trades,
             aliases, match_status, adp_seasons, actuals_seasons)
           VALUES ${values.join(", ")}
           ON CONFLICT (normalized_name, position) DO UPDATE SET
             canonical_name = EXCLUDED.canonical_name,
             in_adp = EXCLUDED.in_adp,
             in_actuals = EXCLUDED.in_actuals,
             in_rookies = EXCLUDED.in_rookies,
             in_trades = EXCLUDED.in_trades,
             aliases = EXCLUDED.aliases,
             match_status = EXCLUDED.match_status,
             adp_seasons = EXCLUDED.adp_seasons,
             actuals_seasons = EXCLUDED.actuals_seasons,
             nfl_draft_year = EXCLUDED.nfl_draft_year,
             updated_at = NOW()`,
          params,
          { label: `Insert canonical players batch ${i / BATCH_SIZE + 1}` }
        );
      }

      committed = true;
      ctx.log.info(`Committed ${allIdentities.length} canonical players to DB`);
    }

    return {
      totalPlayers: allIdentities.length,
      byMatchStatus,
      bySource: { adpOnly, actualsOnly, rookiesOnly, tradesOnly, multiSource },
      sampleAmbiguous,
      committed,
    };
  },
});
