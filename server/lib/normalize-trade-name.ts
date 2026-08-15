/**
 * Canonical player-name normalizer — ONE module used by ALL trade/draft APIs.
 *
 * Authoritative source: ctown_player_identity_map_2018_2026.csv and
 * ctown_trade_player_identity_2019_2026.csv uploaded to ffwr_league_records.
 *
 * Normalization order (per approved plan):
 *   1. Trim whitespace and normalize case/punctuation.
 *   2. Extract "Exp. Rights to [player]" ONLY for keeper-rights assets.
 *   3. Strip a trailing known team abbreviation when it is a separate suffix
 *      (e.g. "Tyler Lockett   LV").
 *   4. Apply the approved alias map.
 *   5. Match using canonical name (+ position/season where available).
 *   6. Leave ambiguous matches unresolved — never guess.
 *
 * The alias map is bidirectional:
 *   - Trade CSV variants → canonical name (e.g. "Marlan Mack" → "Marlon Mack")
 *   - ADP/Actuals source names → canonical name (e.g. "Hollywood Brown" → "Marquise Brown")
 *
 * IMPORTANT: This module normalizes to a LOWERCASED key for matching purposes.
 * The canonical_player_name (display-ready, proper case) is stored separately
 * and looked up via the CANONICAL_DISPLAY_NAMES map.
 */

// ─── Approved Alias Map ─────────────────────────────────────
// Source: ctown_player_identity_map_2018_2026.csv (80 alias rows)
// + ctown_trade_player_identity_2019_2026.csv
// After normalization (lowercase, no periods/apostrophes, no suffixes),
// these source forms map to the canonical normalized key.
//
// Convention: all keys and values are already lowercased, period-stripped,
// suffix-stripped forms. The map goes FROM variant → TO canonical.
const NAME_CORRECTIONS: Record<string, string> = {
  // ── Typos / misspellings from trade CSVs ──
  "patrick maholmes": "patrick mahomes",
  "christian mccaffery": "christian mccaffrey",
  "c mccaffery": "christian mccaffrey",
  "c mccaffrey": "christian mccaffrey",
  "marlan mack": "marlon mack",
  "devonta freemand": "devonta freeman",
  "devanta freeman": "devonta freeman",
  "cordarelle patterson": "cordarrelle patterson",
  "kenyon drake": "kenyan drake",
  "sterling shepherd": "sterling shepard",
  "tetaroia mcmillan": "tetairoa mcmillan",
  "travis ettiene": "travis etienne",
  "adam theilen": "adam thielen",
  "alexaner mattison": "alexander mattison",
  "alshon jeffrey": "alshon jeffery",
  "braelen allen": "braelon allen",
  "byshul tuten": "bhayshul tuten",
  "calvin ridely": "calvin ridley",
  "chubba hubbard": "chuba hubbard",
  "coleston loveland": "colston loveland",
  "davante parker": "devante parker",
  "deandre swift": "dandre swift",
  "derrik henry": "derrick henry",
  "devanta smith": "devonta smith",
  "devante adams": "davante adams",
  "devon achane": "devon achane", // De'Von → devon after apostrophe strip
  "dionate johnson": "diontae johnson",
  "dionte johnson": "diontae johnson",
  "emanuel sanders": "emmanuel sanders",
  "garret wilson": "garrett wilson",
  "jajuan jennings": "jauan jennings",
  "jamarr chase": "jamarr chase", // Ja'Marr → jamarr after apostrophe strip
  "jerry jeduy": "jerry jeudy",
  "jerick mckinon": "jerick mckinnon",
  "kenneth gainwell": "kenneth gainwell",
  "kimoni vidal": "kimani vidal",
  "krik cousins": "kirk cousins",
  "kyla monangai": "kyle monangai",
  "ladd mckonkey": "ladd mcconkey",
  "lagarette blount": "legarrette blount",
  "larry fitz": "larry fitzgerald",
  "latavious murray": "latavius murray",
  "latavis murray": "latavius murray",
  "nelson agholar": "nelson agholor",
  "nich chubb": "nick chubb",
  "pereston williams": "preston williams",
  "p friermuth": "pat freiermuth",
  "raschad white": "rachaad white",
  "rashad bateman": "rashod bateman",
  "rashid shahid": "rashid shaheed",
  "r doubbs": "romeo doubs",
  "roanld jones": "ronald jones",
  "robbie anderson": "robby anderson",
  "robert gronkowski": "rob gronkowski",
  "saquan barkley": "saquon barkley",
  "s laporte": "sam laporta",
  "s laporta": "sam laporta",
  "trevor larence": "trevor lawrence",
  "trey mcbride": "trey mcbride",
  "t tugavailoa": "tua tagovailoa",
  "will fuller": "will fuller",
  "z charbonet": "zach charbonnet",
  "travis eitenne": "travis etienne",
  "philip lindsay": "phillip lindsay",
  "philip lindsey": "phillip lindsay",
  "jav williams": "javonte williams",

  // ── ADP-side aliases (ADP name → canonical name) ──
  // These ensure that when we normalize ADP table names, they match
  // the canonical form used in trade CSVs.
  "hollywood brown": "marquise brown",
  "robbie chosen": "robby anderson",
  "darrel williams": "darrell williams",
  "zack moss": "zach moss",
  "isaiah davis": "isiah davis",
  "treveyon henderson": "treyveon henderson",
  "jacory croskey-merritt": "jacorey croskey-merritt",
  "jacory croskey merritt": "jacorey croskey-merritt",

  // ── Abbreviation / initial-only names from trade CSVs ──
  "d achane": "devon achane",
  "d johnson": "diontae johnson",
  "d london": "drake london",
  "e moore": "elijah moore",
  "mvs": "marquez valdes-scantling",

  // ── Additional corrections from keepers/draft data ──
  "will fuller v": "will fuller",
};

// ─── Canonical Display Names ─────────────────────────────────
// Maps normalized key → proper-case display name (from ADP/Actuals official sources).
// Used to recover the display name after normalization.
export const CANONICAL_DISPLAY_NAMES: Record<string, string> = {
  "patrick mahomes": "Patrick Mahomes II",
  "christian mccaffrey": "Christian McCaffrey",
  "marlon mack": "Marlon Mack",
  "devonta freeman": "Devonta Freeman",
  "cordarrelle patterson": "Cordarrelle Patterson",
  "kenyan drake": "Kenyan Drake",
  "sterling shepard": "Sterling Shepard",
  "tetairoa mcmillan": "Tetairoa McMillan",
  "travis etienne": "Travis Etienne Jr.",
  "adam thielen": "Adam Thielen",
  "alexander mattison": "Alexander Mattison",
  "alshon jeffery": "Alshon Jeffery",
  "braelon allen": "Braelon Allen",
  "bhayshul tuten": "Bhayshul Tuten",
  "calvin ridley": "Calvin Ridley",
  "chuba hubbard": "Chuba Hubbard",
  "colston loveland": "Colston Loveland",
  "devante parker": "DeVante Parker",
  "dandre swift": "D'Andre Swift",
  "derrick henry": "Derrick Henry",
  "devonta smith": "DeVonta Smith",
  "davante adams": "Davante Adams",
  "devon achane": "De'Von Achane",
  "diontae johnson": "Diontae Johnson",
  "emmanuel sanders": "Emmanuel Sanders",
  "garrett wilson": "Garrett Wilson",
  "jauan jennings": "Jauan Jennings",
  "jamarr chase": "Ja'Marr Chase",
  "jerry jeudy": "Jerry Jeudy",
  "jerick mckinnon": "Jerick McKinnon",
  "kimani vidal": "Kimani Vidal",
  "kirk cousins": "Kirk Cousins",
  "kyle monangai": "Kyle Monangai",
  "ladd mcconkey": "Ladd McConkey",
  "legarrette blount": "LeGarrette Blount",
  "larry fitzgerald": "Larry Fitzgerald",
  "latavius murray": "Latavius Murray",
  "nelson agholor": "Nelson Agholor",
  "nick chubb": "Nick Chubb",
  "preston williams": "Preston Williams",
  "pat freiermuth": "Pat Freiermuth",
  "rachaad white": "Rachaad White",
  "rashod bateman": "Rashod Bateman",
  "rashid shaheed": "Rashid Shaheed",
  "romeo doubs": "Romeo Doubs",
  "ronald jones": "Ronald Jones",
  "robby anderson": "Robby Anderson",
  "rob gronkowski": "Rob Gronkowski",
  "saquon barkley": "Saquon Barkley",
  "sam laporta": "Sam LaPorta",
  "trevor lawrence": "Trevor Lawrence",
  "trey mcbride": "Trey McBride",
  "tua tagovailoa": "Tua Tagovailoa",
  "will fuller": "Will Fuller V",
  "zach charbonnet": "Zach Charbonnet",
  "phillip lindsay": "Phillip Lindsay",
  "javonte williams": "Javonte Williams",
  "marquise brown": "Marquise Brown",
  "darrell williams": "Darrell Williams",
  "zach moss": "Zach Moss",
  "isiah davis": "Isaiah Davis",
  "treyveon henderson": "TreVeyon Henderson",
  "jacorey croskey-merritt": "Jacory Croskey-Merritt",
  "marquez valdes-scantling": "Marquez Valdes-Scantling",
  "jk dobbins": "J.K. Dobbins",
  "russell gage": "Russell Gage",
  "rondale moore": "Rondale Moore",
  "kenneth gainwell": "Kenneth Gainwell",
};

// ─── Known NFL Team Abbreviations ────────────────────────────
// Used to strip trailing team codes from ADP names like "Tyler Lockett   LV"
const NFL_TEAM_ABBRS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAC", "JAX",
  "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "OAK", "PHI", "PIT", "SEA", "SF", "TB",
  "TEN", "WAS", "WSH", "FA",
]);

/**
 * Normalize a player name for matching purposes.
 *
 * Returns a lowercased, punctuation-stripped, suffix-stripped key
 * suitable for Map lookups against ADP/Actuals/Trade data.
 *
 * Does NOT handle "Exp. Rights to ..." extraction — use
 * extractKeeperRightsPlayer() for that purpose.
 */
export function normalizeName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/[.']/g, "")            // Step 1: strip periods and apostrophes
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, "")  // Step 1: strip suffixes
    .replace(/\s+/g, " ")           // Step 1: collapse whitespace
    .trim();

  // Step 3: Strip trailing team abbreviation (e.g. "tyler lockett lv")
  // Only strip if the last token is a known 2-3 letter team code
  const parts = n.split(" ");
  if (parts.length >= 3) {
    const lastToken = parts[parts.length - 1].toUpperCase();
    if (NFL_TEAM_ABBRS.has(lastToken) && lastToken.length <= 3) {
      parts.pop();
      n = parts.join(" ");
    }
  }

  // Step 4: Apply approved alias map
  return NAME_CORRECTIONS[n] ?? n;
}

/**
 * Extract the underlying player from a keeper-rights asset text.
 *
 * Input:  "Exp. Rights to Marvin Harrison Jr."
 * Output: { isKeeperRights: true, underlyingPlayer: "Marvin Harrison Jr." }
 *
 * Input:  "Travis Kelce"
 * Output: { isKeeperRights: false, underlyingPlayer: null }
 */
export function extractKeeperRightsPlayer(assetText: string): {
  isKeeperRights: boolean;
  underlyingPlayer: string | null;
} {
  const match = assetText.match(/^exp\.?\s*rights\s+to\s+(.+)$/i);
  if (match) {
    return {
      isKeeperRights: true,
      underlyingPlayer: match[1].trim(),
    };
  }
  return { isKeeperRights: false, underlyingPlayer: null };
}

/**
 * Get the canonical display name for a normalized key.
 * Falls back to the input name if no canonical mapping exists.
 */
export function getCanonicalDisplayName(normalizedName: string, fallbackName?: string): string {
  return CANONICAL_DISPLAY_NAMES[normalizedName] ?? fallbackName ?? normalizedName;
}

/**
 * Determine the match method used to resolve a name.
 *
 * @param sourceName - The original source name (from trade CSV, etc.)
 * @param normalizedResult - The output of normalizeName(sourceName)
 * @returns The match method classification
 */
export function classifyMatchMethod(
  sourceName: string,
  normalizedResult: string,
): "exact_normalized" | "alias" | "suffix_strip" | "team_abbr_strip" | "punctuation_strip" {
  const lower = sourceName.toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();

  // Check if the correction map was used
  const withoutSuffix = lower.replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, "").replace(/\s+/g, " ").trim();
  if (NAME_CORRECTIONS[withoutSuffix] && NAME_CORRECTIONS[withoutSuffix] !== withoutSuffix) {
    return "alias";
  }

  // Check if suffix stripping changed anything meaningful
  if (lower !== withoutSuffix && withoutSuffix === normalizedResult) {
    return "suffix_strip";
  }

  // Check if team abbreviation was stripped
  const parts = withoutSuffix.split(" ");
  if (parts.length >= 3) {
    const lastToken = parts[parts.length - 1].toUpperCase();
    if (NFL_TEAM_ABBRS.has(lastToken)) {
      return "team_abbr_strip";
    }
  }

  // Check if only punctuation was different
  if (sourceName.toLowerCase().replace(/\s+/g, " ").trim() !== lower) {
    return "punctuation_strip";
  }

  return "exact_normalized";
}
