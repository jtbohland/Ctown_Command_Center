import { useState, useCallback, useRef, useMemo, memo } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "lucide-react/dynamic";
import { Input } from "@/components/ui/input";

// ─── Types ──────────────────────────────────────────────────
interface LeagueRecord {
  id: number;
  category: string;
  season: string | null;
  filename: string;
  uploaded_at: string;
  uploaded_by: string | null;
  notes: string | null;
  size_bytes: number;
}

type SeasonCount = { season: number; count: number };

type SeedResult = {
  keepersInserted: number;
  keepersSkipped: number;
  keepersBySeason: SeasonCount[];
  picksInserted: number;
  picksBySeason: SeasonCount[];
  duplicateKeepers: number;
  duplicatePicks: number;
  message: string;
};

// ─── Constants ──────────────────────────────────────────────
const CATEGORIES = [
  { value: "keepers", label: "Keepers", icon: "shield" as IconName },
  { value: "draft_picks", label: "Draft Picks", icon: "list-ordered" as IconName },
  { value: "trades", label: "Trades", icon: "arrow-left-right" as IconName },
  { value: "rosters", label: "Rosters", icon: "clipboard-list" as IconName },
  { value: "rankings", label: "Rankings", icon: "trophy" as IconName },
  { value: "other", label: "Other", icon: "file-text" as IconName },
];

const SEASONS = Array.from({ length: 12 }, (_, i) => String(2024 + i));

// ─── Upload Slot (moved from HistoricalUploader) ────────────
function UploadSlot({
  label,
  icon,
  description,
  accept,
  loading,
  result,
  seasonKey,
  onUpload,
}: {
  label: string;
  icon: IconName;
  description: string;
  accept: string;
  loading: boolean;
  result: SeedResult | null;
  seasonKey: "keepersBySeason" | "picksBySeason";
  onUpload: (csvText: string) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setSelectedFile(file);
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    const text = await selectedFile.text();
    await onUpload(text);
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [selectedFile, onUpload]);

  const seasons = result?.[seasonKey] ?? [];

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Icon icon={icon} className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
        />
        <Button
          size="sm"
          onClick={handleUpload}
          disabled={!selectedFile || loading}
          className="h-8 text-xs"
        >
          {loading ? (
            <>
              <Icon icon="loader-2" className="h-3 w-3 mr-1 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Icon icon="upload" className="h-3 w-3 mr-1" />
              Upload
            </>
          )}
        </Button>
      </div>

      {seasons.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Loaded Seasons
          </p>
          <div className="flex flex-wrap gap-1.5">
            {seasons.map((s) => (
              <Badge key={s.season} variant="secondary" className="text-xs">
                {s.season} ({s.count})
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Record Row ─────────────────────────────────────────────
const RecordRow = memo(function RecordRow({
  record,
  onDownload,
  downloading,
}: {
  record: LeagueRecord;
  onDownload: (id: number, filename: string) => void;
  downloading: number | null;
}) {
  const cat = CATEGORIES.find((c) => c.value === record.category);
  const date = new Date(record.uploaded_at);
  const sizeKb = (record.size_bytes / 1024).toFixed(1);

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/30 transition-colors text-sm">
      <Icon
        icon={cat?.icon ?? "file-text"}
        className="h-4 w-4 text-muted-foreground shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{record.filename}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
            {cat?.label ?? record.category}
          </Badge>
          {record.season && (
            <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
              {record.season}
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {sizeKb} KB • {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {record.uploaded_by && ` • ${record.uploaded_by}`}
          {record.notes && ` • ${record.notes}`}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => onDownload(record.id, record.filename)}
        disabled={downloading === record.id}
      >
        {downloading === record.id ? (
          <Icon icon="loader-2" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon icon="download" className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────
export default function LeagueOfRecord() {
  // ── Historical Draft Intelligence state ───────────────────
  const { run: seedKeepers, loading: keepersLoading } = useApi("SeedHistoricalKeepersPicks");
  const { run: seedPicks, loading: picksLoading } = useApi("SeedHistoricalKeepersPicks");
  const [keeperResult, setKeeperResult] = useState<SeedResult | null>(null);
  const [picksResult, setPicksResult] = useState<SeedResult | null>(null);

  const handleKeepersUpload = useCallback(
    async (csvText: string) => {
      try {
        const result = await seedKeepers({ keepersCsv: csvText });
        const res = result as SeedResult;
        setKeeperResult(res);
        if (res.keepersInserted === 0) {
          toast.warning(res.message);
        } else {
          toast.success(
            `Loaded ${res.keepersInserted} keepers (${res.keepersSkipped} placeholders skipped) across ${res.keepersBySeason.length} seasons`
          );
        }
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Keepers upload failed: " + message);
      }
    },
    [seedKeepers]
  );

  const handlePicksUpload = useCallback(
    async (csvText: string) => {
      try {
        const result = await seedPicks({ draftPicksCsv: csvText });
        const res = result as SeedResult;
        setPicksResult(res);
        toast.success(
          `Loaded ${res.picksInserted} draft picks across ${res.picksBySeason.length} seasons`
        );
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Draft picks upload failed: " + message);
      }
    },
    [seedPicks]
  );

  // ── Archive state ─────────────────────────────────────────
  const { data: recordsData, loading: recordsLoading, refetch: refetchRecords } = useApiData("GetLeagueRecords", {});
  const { run: saveRecord, loading: saving } = useApi("SaveLeagueRecord");
  const { run: downloadRecord } = useApi("DownloadLeagueRecord");

  const records = recordsData?.records ?? [];

  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveCategory, setArchiveCategory] = useState("keepers");
  const [archiveSeason, setArchiveSeason] = useState<string>("");
  const [archiveNotes, setArchiveNotes] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);
  const archiveFileRef = useRef<HTMLInputElement>(null);

  const handleArchiveUpload = useCallback(async () => {
    if (!archiveFile) return;
    try {
      const text = await archiveFile.text();
      await saveRecord({
        category: archiveCategory,
        season: archiveSeason || null,
        filename: archiveFile.name,
        fileContent: text,
        notes: archiveNotes || null,
      });
      toast.success(`Archived "${archiveFile.name}"`);
      setArchiveFile(null);
      setArchiveNotes("");
      if (archiveFileRef.current) archiveFileRef.current.value = "";
      await refetchRecords();
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Archive failed: " + message);
    }
  }, [archiveFile, archiveCategory, archiveSeason, archiveNotes, saveRecord, refetchRecords]);

  const handleDownload = useCallback(
    async (id: number, filename: string) => {
      try {
        setDownloading(id);
        const result = await downloadRecord({ recordId: id });
        const content = (result as { fileContent: string }).fileContent;
        // Trigger browser download
        const blob = new Blob([content], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Download failed: " + message);
      } finally {
        setDownloading(null);
      }
    },
    [downloadRecord]
  );

  // Group records by category for display
  const groupedRecords = useMemo(() => {
    const map = new Map<string, LeagueRecord[]>();
    for (const r of records) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [records]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon icon="archive" className="h-4 w-4" />
          The League of Record
        </CardTitle>
        <CardDescription>
          Upload and archive every historical CSV &mdash; keepers, draft picks, trades, rosters, rankings.
          Files are stored for auditing, cross-checking, and reference.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Historical Draft Intelligence (moved here) ─────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-border">
            <Icon icon="history" className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Historical Draft Intelligence</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload C-Town keeper and draft pick history. Re-upload after each
            season&rsquo;s draft to keep compiling data. Safe to re-run &mdash;
            existing records are preserved.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UploadSlot
              label="Historic Keepers"
              icon="shield"
              description="CSV with columns: season, manager, player, position. Placeholder rows (--) are skipped."
              accept=".csv"
              loading={keepersLoading}
              result={keeperResult}
              seasonKey="keepersBySeason"
              onUpload={handleKeepersUpload}
            />
            <UploadSlot
              label="Historic Draft Picks"
              icon="list-ordered"
              description="CSV with columns: draft_year, pick, player. Records every C-Town draft selection by pick number."
              accept=".csv"
              loading={picksLoading}
              result={picksResult}
              seasonKey="picksBySeason"
              onUpload={handlePicksUpload}
            />
          </div>
        </div>

        {/* ── Archive Upload ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-border">
            <Icon icon="upload" className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Archive a File</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select value={archiveCategory} onValueChange={setArchiveCategory}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <div className="flex items-center gap-1.5">
                      <Icon icon={c.icon} className="h-3 w-3" />
                      {c.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={archiveSeason} onValueChange={(v) => setArchiveSeason(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Season (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No season</SelectItem>
                {SEASONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={archiveNotes}
              onChange={(e) => setArchiveNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={archiveFileRef}
              type="file"
              accept=".csv,.txt,.json"
              onChange={(e) => setArchiveFile(e.target.files?.[0] ?? null)}
              className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer flex-1"
            />
            <Button
              size="sm"
              onClick={handleArchiveUpload}
              disabled={!archiveFile || saving}
              className="h-8 text-xs"
            >
              {saving ? (
                <>
                  <Icon icon="loader-2" className="h-3 w-3 mr-1 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Icon icon="archive" className="h-3 w-3 mr-1" />
                  Archive
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── Archived Files ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-border">
            <Icon icon="folder-open" className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Archived Files</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {records.length} file{records.length !== 1 ? "s" : ""}
            </span>
          </div>

          {recordsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-6">
              <Icon icon="archive" className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                No files archived yet. Upload a CSV above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedRecords.map(([category, recs]) => {
                const cat = CATEGORIES.find((c) => c.value === category);
                return (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon
                        icon={cat?.icon ?? "file-text"}
                        className="h-3.5 w-3.5 text-muted-foreground"
                      />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {cat?.label ?? category} ({recs.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {recs.map((r) => (
                        <RecordRow
                          key={r.id}
                          record={r}
                          onDownload={handleDownload}
                          downloading={downloading}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
