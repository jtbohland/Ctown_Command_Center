import { useCallback, useRef, useState, memo } from "react";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type PreviewState = {
  parsed: number;
  skippedPositions: number;
  sampleRows: Array<{ rank: number; name: string; position: string; nflTeam: string | null }>;
  csvData: string;
  filename: string;
};

const ExchangeAdpUploader = memo(function ExchangeAdpUploader({
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const { run: seedAdp, loading: seeding } = useApi("SeedExchangeAdp");

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Read the file as text
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim().length > 0);

      if (lines.length < 2) {
        toast.error("CSV must have at least a header and one data row");
        return;
      }

      // Quick dry-run to preview
      try {
        const result = await seedAdp({ csvData: text, dryRun: true });
        setPreview({
          parsed: result?.parsed ?? 0,
          skippedPositions: result?.skippedPositions ?? 0,
          sampleRows: result?.sampleRows ?? [],
          csvData: text,
          filename: file.name,
        });
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
        toast.error("Parse error: " + message);
      }

      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [seedAdp],
  );

  const handleConfirmUpload = useCallback(async () => {
    if (!preview) return;
    try {
      const result = await seedAdp({ csvData: preview.csvData, dryRun: false });
      toast.success(result?.message ?? "Exchange ADP uploaded!");
      setPreview(null);
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      toast.error("Upload failed: " + message);
    }
  }, [seedAdp, preview, onOpenChange, onSuccess]);

  const handleCancel = useCallback(() => {
    setPreview(null);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>📊 Upload Current ADP</DialogTitle>
          <DialogDescription>
            Upload a FantasyPros-format ADP CSV to set the Exchange baseline.
            This is separate from draft ADP — it reflects current market values
            for team grading.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        {!preview ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={seeding}
            >
              📁 Choose CSV File
            </Button>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Expected format: Rank, Player (Bye), POS, ...
              <br />
              DST and K positions are automatically skipped.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[400px]">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {preview.filename}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {preview.parsed} players
              </Badge>
              {preview.skippedPositions > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {preview.skippedPositions} DST/K skipped
                </Badge>
              )}
            </div>

            <ScrollArea className="min-h-0 flex-1 border rounded-md">
              <div className="p-2 space-y-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2">
                  Sample Rows
                </div>
                {preview.sampleRows.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-muted/30"
                  >
                    <span className="text-muted-foreground w-8 text-right font-mono">
                      #{row.rank}
                    </span>
                    <span className="font-medium flex-1 truncate">{row.name}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {row.position}
                    </Badge>
                    {row.nflTeam && (
                      <span className="text-[10px] text-muted-foreground">{row.nflTeam}</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <p className="text-xs text-amber-400">
              ⚠️ This will replace all existing Exchange ADP data.
            </p>
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={handleCancel} disabled={seeding}>
            Cancel
          </Button>
          {preview && (
            <Button onClick={handleConfirmUpload} disabled={seeding}>
              {seeding ? "Uploading..." : `Upload ${preview.parsed} players`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default ExchangeAdpUploader;
