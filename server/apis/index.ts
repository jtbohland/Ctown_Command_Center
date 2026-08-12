import InitDatabase from './draft/init-database.js';
import GetPlayers from './draft/get-players.js';
import GetTeams from './draft/get-teams.js';
import GetDraftPicks from './draft/get-draft-picks.js';
import DraftPlayer from './draft/draft-player.js';
import UndoDraftPick from './draft/undo-draft-pick.js';
import TogglePlayerTag from './draft/toggle-player-tag.js';
import UploadPlayers from './draft/upload-players.js';
import ManageKeepers from './draft/manage-keepers.js';
import MergeDuplicatePlayers from './draft/merge-duplicates.js';
import RunMockDraft from './draft/run-mock-draft.js';
import UpdateAdpFromCsv from './draft/update-adp.js';
import BulkTagHandcuffs from './draft/bulk-tag-handcuffs.js';
import MergeDuplicatePair from './draft/merge-duplicate-pair.js';
import BulkTagRookies from './draft/bulk-tag-rookies.js';
import InitTradeTables from './trades/init-trade-tables.js';
import SeedDraftCapital from './trades/seed-draft-capital.js';
import SeedTradeHistory from './trades/seed-trade-history.js';
import SeedHistoricalAdp from './trades/seed-historical-adp.js';
import GetTradeData from './trades/get-trade-data.js';
import EvaluateTrade from './trades/evaluate-trade.js';
import SaveTrade from './trades/save-trade.js';
import SeedHistoricalAdpV2 from './trades/seed-historical-adp-v2.js';
import SeedHistoricalTradesV2 from './trades/seed-historical-trades-v2.js';
import ReseedTradesFromCsv from './trades/reseed-trades-from-csv.js';
import DedupTrades from './trades/dedup-trades.js';
import SeedRookieClasses from './trades/seed-rookie-classes.js';
import SeedAdpFromCsv from './trades/seed-adp-from-csv.js';
import DataQualityCheck from './trades/data-quality-check.js';
import BackfillPickYear from './trades/backfill-pick-year.js';
import MigrateThreeTeam from './trades/migrate-three-team.js';
import BackfillTwoTeamDefaults from './trades/backfill-two-team-defaults.js';
import RepairThreeTeamTrades from './trades/repair-three-team-trades.js';
import InitSeasonActuals from './trades/init-season-actuals.js';
import SeedSeasonActuals from './trades/seed-season-actuals.js';


const apis = {
  InitDatabase,
  GetPlayers,
  GetTeams,
  GetDraftPicks,
  DraftPlayer,
  UndoDraftPick,
  TogglePlayerTag,
  UploadPlayers,
  ManageKeepers,
  MergeDuplicatePlayers,
  RunMockDraft,
  UpdateAdpFromCsv,
  BulkTagHandcuffs,
  MergeDuplicatePair,
  BulkTagRookies,
  InitTradeTables,
  SeedDraftCapital,
  SeedTradeHistory,
  SeedHistoricalAdp,
  GetTradeData,
  EvaluateTrade,
  SaveTrade,
  SeedHistoricalAdpV2,
  SeedHistoricalTradesV2,
  ReseedTradesFromCsv,
  DedupTrades,
  SeedRookieClasses,
  SeedAdpFromCsv,
  DataQualityCheck,
  BackfillPickYear,
  MigrateThreeTeam,
  BackfillTwoTeamDefaults,
  RepairThreeTeamTrades,
  InitSeasonActuals,
  SeedSeasonActuals,
} as const;

export default apis;

export type ApiRegistry = typeof apis;
