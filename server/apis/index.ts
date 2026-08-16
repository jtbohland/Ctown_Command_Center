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
import InitCanonicalPlayers from './trades/init-canonical-players.js';
import BuildPlayerIdentityMap from './trades/build-player-identity-map.js';
import InitPlayerScores from './trades/init-player-scores.js';
import BuildActualsScores from './trades/build-actuals-scores.js';
import SeedActualsFromFile from './trades/seed-actuals-from-file.js';
import GetLoadedActualSeasons from './trades/get-loaded-actual-seasons.js';
import RepairTrade28Assets from './trades/repair-trade-28-assets.js';
import ComputeTradeActuals from './trades/compute-trade-actuals.js';
import SeedRosters from './trades/seed-rosters.js';
import GetRosterData from './trades/get-roster-data.js';
import Redraft from './trades/redraft.js';
import FixActualsSeasons from './trades/fix-actuals-seasons.js';
import SeedHistoricalKeepersPicks from './draft/seed-historical-keepers-picks.js';
import WriteInPlayer from './draft/write-in-player.js';
import InitLeagueRecords from './settings/init-league-records.js';
import SaveLeagueRecord from './settings/save-league-record.js';
import GetLeagueRecords from './settings/get-league-records.js';
import DownloadLeagueRecord from './settings/download-league-record.js';
import BackfillTradeVerdicts from './trades/backfill-trade-verdicts.js';
import ProvenanceReport from './trades/provenance-report.js';
import CrossSurfaceComparison from './trades/cross-surface-comparison.js';
import TakeVerdictSnapshot from './trades/take-verdict-snapshot.js';


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
  SeedActualsFromFile,
  GetLoadedActualSeasons,
  InitCanonicalPlayers,
  BuildPlayerIdentityMap,
  InitPlayerScores,
  BuildActualsScores,
  RepairTrade28Assets,
  ComputeTradeActuals,
  SeedRosters,
  GetRosterData,
  Redraft,
  FixActualsSeasons,
  SeedHistoricalKeepersPicks,
  WriteInPlayer,
  InitLeagueRecords,
  SaveLeagueRecord,
  GetLeagueRecords,
  DownloadLeagueRecord,
  BackfillTradeVerdicts,
  ProvenanceReport,
  CrossSurfaceComparison,
  TakeVerdictSnapshot,
} as const;

export default apis;

export type ApiRegistry = typeof apis;
