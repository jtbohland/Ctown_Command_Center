import InitDatabase from './draft/init-database.js';
import GetPlayers from './draft/get-players.js';
import GetTeams from './draft/get-teams.js';
import GetDraftPicks from './draft/get-draft-picks.js';
import DraftPlayer from './draft/draft-player.js';
import UndoDraftPick from './draft/undo-draft-pick.js';
import TogglePlayerTag from './draft/toggle-player-tag.js';
import UploadPlayers from './draft/upload-players.js';
import ManageKeepers from './draft/manage-keepers.js';
// [Phase 1] De-registered: MergeDuplicatePlayers (DELETE player — no dryRun default safe but no UI caller)
import RunMockDraft from './draft/run-mock-draft.js';
// [Phase 1] De-registered: UpdateAdpFromCsv, BulkTagHandcuffs, MergeDuplicatePair, BulkTagRookies (no UI caller)
import InitTradeTables from './trades/init-trade-tables.js';
// [Phase 1] De-registered destructive seed APIs: SeedDraftCapital, SeedTradeHistory, SeedHistoricalAdp
import GetTradeData from './trades/get-trade-data.js';
import EvaluateTrade from './trades/evaluate-trade.js';
import SaveTrade from './trades/save-trade.js';
import PersistTradeVerdict from './trades/persist-trade-verdict.js';
// [Phase 1] De-registered destructive seed APIs: SeedHistoricalAdpV2, SeedHistoricalTradesV2,
// ReseedTradesFromCsv, DedupTrades, SeedRookieClasses, SeedAdpFromCsv
import DataQualityCheck from './trades/data-quality-check.js';
// [Phase 1] De-registered: BackfillPickYear, MigrateThreeTeam, BackfillTwoTeamDefaults, RepairThreeTeamTrades
import InitSeasonActuals from './trades/init-season-actuals.js';
import InitCanonicalPlayers from './trades/init-canonical-players.js';
// [Phase 1] De-registered: BuildPlayerIdentityMap (destructive — wipes canonical_players)
import InitPlayerScores from './trades/init-player-scores.js';
// [Phase 1] De-registered: BuildActualsScores (destructive — wipes player_scores)
import SeedActualsFromFile from './trades/seed-actuals-from-file.js';
import GetLoadedActualSeasons from './trades/get-loaded-actual-seasons.js';
// [Phase 1] De-registered: RepairTrade28Assets (one-time INSERT, no dryRun)
import ComputeTradeActuals from './trades/compute-trade-actuals.js';
import SeedRosters from './trades/seed-rosters.js';
import GetRosterData from './trades/get-roster-data.js';
import Redraft from './trades/redraft.js';
// [Phase 1] De-registered: FixActualsSeasons (UPDATE, no safe default)
import SeedHistoricalKeepersPicks from './draft/seed-historical-keepers-picks.js';
import WriteInPlayer from './draft/write-in-player.js';
import GenerateDraftRecap from './draft/generate-draft-recap.js';
import ArchiveDraft from './draft/archive-draft.js';
import InitLeagueRecords from './settings/init-league-records.js';
import SaveLeagueRecord from './settings/save-league-record.js';
import GetLeagueRecords from './settings/get-league-records.js';
import DownloadLeagueRecord from './settings/download-league-record.js';
// [Phase 1] De-registered: BackfillTradeVerdicts (dryRun defaults to undefined → runs live)
import ProvenanceReport from './trades/provenance-report.js';
import CanonicalVerdictAudit from './trades/canonical-verdict-audit.js';
import TakeVerdictSnapshot from './trades/take-verdict-snapshot.js';
import FantasyWiz from './chat/fantasy-wiz.js';
import AddChampionships from './draft/add-championships.js';
import InitWaiverTransactions from './waivers/init-waiver-transactions.js';
import ParseWaiverScreenshot from './waivers/parse-waiver-screenshot.js';
import ApplyWaiverTransactions from './waivers/apply-waiver-transactions.js';
import GetWaiverTransactions from './waivers/get-waiver-transactions.js';
import BackupTables from './settings/backup-tables.js';


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
  RunMockDraft,
  InitTradeTables,

  GetTradeData,
  EvaluateTrade,
  SaveTrade,
  PersistTradeVerdict,

  DataQualityCheck,

  InitSeasonActuals,
  SeedActualsFromFile,
  GetLoadedActualSeasons,
  InitCanonicalPlayers,

  InitPlayerScores,


  ComputeTradeActuals,
  SeedRosters,
  GetRosterData,
  Redraft,

  SeedHistoricalKeepersPicks,
  WriteInPlayer,
  GenerateDraftRecap,
  ArchiveDraft,
  InitLeagueRecords,
  SaveLeagueRecord,
  GetLeagueRecords,
  DownloadLeagueRecord,

  ProvenanceReport,
  CanonicalVerdictAudit,
  TakeVerdictSnapshot,
  FantasyWiz,
  AddChampionships,
  InitWaiverTransactions,
  ParseWaiverScreenshot,
  ApplyWaiverTransactions,
  GetWaiverTransactions,
  BackupTables,
} as const;

export default apis;

export type ApiRegistry = typeof apis;
