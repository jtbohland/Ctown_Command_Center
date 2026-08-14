import { useCallback, useRef, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "lucide-react/dynamic";
import { toast } from "sonner";

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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  }, []);

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

      {/* Results summary */}
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

export default function HistoricalUploader() {
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
            `Loaded ${res.keepersInserted} keepers (${res.keepersSkipped} placeholders skipped) across ${res.keepersBySeason.length} seasons`,
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
    [seedKeepers],
  );

  const handlePicksUpload = useCallback(
    async (csvText: string) => {
      try {
        const result = await seedPicks({ draftPicksCsv: csvText });
        const res = result as SeedResult;
        setPicksResult(res);
        toast.success(
          `Loaded ${res.picksInserted} draft picks across ${res.picksBySeason.length} seasons`,
        );
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Draft picks upload failed: " + message);
      }
    },
    [seedPicks],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon icon="history" className="h-4 w-4" />
          Historical Draft Intelligence
        </CardTitle>
        <CardDescription>
          Upload C-Town keeper and draft pick history. Re-upload after each season's
          draft to keep compiling data. Safe to re-run — existing records are preserved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
}
