import { useCallback, useMemo, useRef, useState } from "react";

import { useApi } from "@/hooks/useApi";
import { useApiData } from "@/hooks/useApiData";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import ValidationPreview from "@/components/seed/ValidationPreview";
import { toast } from "sonner";

/** Year options: 2019–2026 (end-year labels for seasons 2018-19 through 2025-26) */
const YEAR_OPTIONS = ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];

function yearToSeason(yearLabel: string): string {
  const endYear = parseInt(yearLabel, 10);
  return `${endYear - 1}-${String(endYear).slice(-2)}`;
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

export default function SeedActuals() {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [seedComplete, setSeedComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing seasons for the guard
  const { data: loadedSeasons, fetching: loadingSeasons } = useApiData(
    "GetLoadedActualSeasons",
    {},
  );

  const { run: runSeedApi, loading: seedLoading } = useApi("SeedActualsFromFile");

  // Check if selected season is already loaded
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
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold">Seed Season Actuals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a FantasyPros PPR scoring leaders CSV to seed weekly scoring data for a season.
        </p>
      </div>

      <Separator />

      {/* Loaded Seasons */}
      {loadedSeasons && loadedSeasons.seasons.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Already Loaded Seasons</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-2">
              {loadedSeasons.seasons.map((s) => (
                <Badge key={s.season} variant="secondary">
                  {s.season} ({s.playerCount} players)
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex flex-col gap-1.5 w-48">
          <label className="text-sm font-medium">Season (End Year)</label>
          <Select value={selectedYear} onValueChange={(v) => {
            setSelectedYear(v);
            setPreviewData(null);
            setSeedComplete(false);
          }}>
            <SelectTrigger>
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
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              Already loaded: {existingSeasonInfo.playerCount} players
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium">CSV File</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            disabled={!selectedYear}
            className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium hover:file:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {!selectedYear && (
            <p className="text-xs text-muted-foreground">Select a season first</p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handlePreview}
          disabled={!canPreview}
          variant="outline"
        >
          {seedLoading && !previewData ? "Parsing..." : "Preview & Validate"}
        </Button>

        <Button
          onClick={handleSeed}
          disabled={!canSeed}
        >
          {seedLoading && previewData ? "Seeding..." : "Seed to Database"}
        </Button>

        {(previewData || seedComplete) && (
          <Button variant="ghost" onClick={handleReset}>
            Reset
          </Button>
        )}
      </div>

      {/* Loading */}
      {seedLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          {previewData ? "Seeding data..." : "Parsing CSV..."}
        </div>
      )}

      {/* Seed Success */}
      {seedComplete && previewData && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="py-4 px-4">
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">
              ✓ Successfully seeded {previewData.inserted} players for {previewData.season}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {previewData.message}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Validation Preview */}
      {previewData && (
        <ValidationPreview data={previewData} selectedYear={selectedYear} />
      )}
    </div>
  );
}
