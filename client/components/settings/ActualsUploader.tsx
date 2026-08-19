import { useCallback, useMemo, useRef, useState } from "react";

import { useApi } from "@/hooks/useApi";
import { useApiData } from "@/hooks/useApiData";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ValidationPreview from "@/components/seed/ValidationPreview";
import { toast } from "sonner";
import { queryClient } from "@superblocksteam/library";

/**
 * Year options — the label is the START year of the NFL season.
 * e.g. "2025" → season "2025-26" (NFL season from Sept 2025 to Feb 2026).
 * Range: 2019 through 2027 covers all historical + upcoming seasons.
 */
const YEAR_OPTIONS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027"];

function yearToSeason(yearLabel: string): string {
  const startYear = parseInt(yearLabel, 10);
  const endSuffix = String(startYear + 1).slice(-2);
  return `${startYear}-${endSuffix}`;
}

type PreviewData = {
  season: string;
  filename: string;
  columnNames: string[];
  totalRows: number;
  validRows: number;
  skippedKDst: number;
  duplicateCount: number;
  duplicateNames: string[];
  validationIssues: { row: number; field: string; value: string; problem: string }[];
  sampleRows: { rank: number; name: string; team: string; position: string; gp: number; avg: number; total: number }[];
  inserted: number;
  seasonAlreadyLoaded: boolean;
  existingRowCount: number;
  message: string;
};

export default function ActualsUploader() {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [seedComplete, setSeedComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: loadedSeasons, fetching: loadingSeasons } = useApiData(
    "GetLoadedActualSeasons",
    {},
  );

  const { run: runSeedApi, loading: seedLoading } = useApi("SeedActualsFromFile");

  const existingSeasonInfo = useMemo(() => {
    if (!selectedYear || !loadedSeasons?.seasons) return null;
    const season = yearToSeason(selectedYear);
    return loadedSeasons.seasons.find((s) => s.season === season) ?? null;
  }, [selectedYear, loadedSeasons]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setPreviewData(null);
    setSeedComplete(false);
  }, []);

  const handlePreview = useCallback(async () => {
    if (!selectedYear || !selectedFile) return;
    try {
      const result = await runSeedApi({
        csvFile: { files: [selectedFile] } as any,
        yearLabel: selectedYear,
        dryRun: true,
        forceReplace: false,
      });
      if (result) {
        setPreviewData(result as PreviewData);
        setSeedComplete(false);
      }
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Preview failed: " + message);
    }
  }, [selectedYear, selectedFile, runSeedApi]);

  const handleSeed = useCallback(async () => {
    if (!selectedYear || !selectedFile || !previewData) return;
    try {
      const result = await runSeedApi({
        csvFile: { files: [selectedFile] } as any,
        yearLabel: selectedYear,
        dryRun: false,
        forceReplace: previewData.seasonAlreadyLoaded,
      });
      if (result) {
        setPreviewData(result as PreviewData);
        setSeedComplete(true);
        toast.success(
          `Seeded ${(result as PreviewData).inserted} players for ${(result as PreviewData).season}`,
        );
        await queryClient.invalidateQueries("GetLoadedActualSeasons");
      }
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Seed failed: " + message);
    }
  }, [selectedYear, selectedFile, previewData, runSeedApi]);

  const handleReset = useCallback(() => {
    setSelectedYear("");
    setSelectedFile(null);
    setPreviewData(null);
    setSeedComplete(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const canPreview = !!selectedYear && !!selectedFile && !seedLoading;
  const canSeed = !!previewData && !seedComplete && !seedLoading && previewData.validRows > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon icon="bar-chart-3" className="h-4 w-4" />
          Fantasy Football Leaders (Actuals v. ADP)
        </CardTitle>
        <CardDescription>
          Upload a FantasyPros PPR scoring leaders CSV to seed weekly scoring data.
          Upload after each week to keep in-season valuations current.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Already Loaded Seasons */}
        {loadedSeasons && loadedSeasons.seasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Loaded Seasons</p>
            <div className="flex flex-wrap gap-1.5">
              {loadedSeasons.seasons.map((s) => (
                <Badge key={s.season} variant="secondary" className="text-xs">
                  {s.season}
                  {s.throughWeek != null && ` · Wk ${s.throughWeek}`}
                  {s.throughWeek == null && ` · Full`}
                  {` · ${s.playerCount} players`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-col gap-1 w-52">
            <label className="text-xs font-medium">Season (Start Year)</label>
            <Select value={selectedYear} onValueChange={(v) => {
              setSelectedYear(v);
              setPreviewData(null);
              setSeedComplete(false);
            }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select year..." />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((yr) => {
                  const season = yearToSeason(yr);
                  const isLoaded = loadedSeasons?.seasons.some((s) => s.season === season);
                  return (
                    <SelectItem key={yr} value={yr}>
                      {yr} ({season}) {isLoaded ? "✓" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {existingSeasonInfo && (
      <p className="text-[10px] text-yellow-600 dark:text-yellow-400">
              Already loaded: {existingSeasonInfo.playerCount} players
              {existingSeasonInfo.throughWeek != null && ` (through Wk ${existingSeasonInfo.throughWeek})`}
            </p>
            )}
          </div>

          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium">CSV File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={!selectedYear}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium hover:file:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {!selectedYear && (
              <p className="text-[10px] text-muted-foreground">Select a season first</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handlePreview}
            disabled={!canPreview}
            variant="outline"
            size="sm"
          >
            {seedLoading && !previewData ? "Parsing..." : "Preview & Validate"}
          </Button>

          <Button
            onClick={handleSeed}
            disabled={!canSeed}
            size="sm"
          >
            {seedLoading && previewData ? "Seeding..." : "Seed to Database"}
          </Button>

          {(previewData || seedComplete) && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset
            </Button>
          )}
        </div>

        {/* Loading spinner */}
        {seedLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="animate-spin h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full" />
            {previewData ? "Seeding data..." : "Parsing CSV..."}
          </div>
        )}

        {/* Seed Success */}
        {seedComplete && previewData && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 py-3 px-4">
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">
              ✓ Successfully seeded {previewData.inserted} players for {previewData.season}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{previewData.message}</p>
          </div>
        )}

        {/* Validation Preview */}
        {previewData && (
          <ValidationPreview data={previewData} selectedYear={selectedYear} />
        )}
      </CardContent>
    </Card>
  );
}
