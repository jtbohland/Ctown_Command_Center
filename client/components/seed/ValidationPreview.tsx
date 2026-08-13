import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SampleRow {
  rank: number;
  name: string;
  team: string;
  position: string;
  gp: number;
  avg: number;
  total: number;
}

interface ValidationIssue {
  row: number;
  field: string;
  value: string;
  problem: string;
}

interface PreviewData {
  season: string;
  filename: string;
  columnNames: string[];
  totalRows: number;
  validRows: number;
  skippedKDst: number;
  duplicateCount: number;
  duplicateNames: string[];
  validationIssues: ValidationIssue[];
  sampleRows: SampleRow[];
  seasonAlreadyLoaded: boolean;
  existingRowCount: number;
  message: string;
}

interface Props {
  data: PreviewData;
  selectedYear: string;
}

export default function ValidationPreview({ data, selectedYear }: Props) {
  const hasIssues = data.validationIssues.length > 0;
  const hasDuplicates = data.duplicateCount > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Season" value={data.season} />
        <SummaryCard label="File" value={data.filename} />
        <SummaryCard label="Valid Players" value={String(data.validRows)} />
        <SummaryCard label="K/DST Skipped" value={String(data.skippedKDst)} />
      </div>

      {/* Season label confirmation */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 px-4">
          <p className="text-sm">
            <span className="font-medium">Season label:</span> You selected{" "}
            <Badge variant="outline" className="mx-1">{selectedYear}</Badge>
            → stored as{" "}
            <Badge variant="outline" className="mx-1">{data.season}</Badge>.
            This is <span className="font-semibold">not inferred from the filename</span>.
          </p>
        </CardContent>
      </Card>

      {/* Already loaded warning */}
      {data.seasonAlreadyLoaded && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-3 px-4">
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
              ⚠ Season {data.season} already has {data.existingRowCount} rows loaded.
              Seeding will replace all existing data for this season.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Detected Columns */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Detected Columns ({data.columnNames.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {data.columnNames.map((col, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {col}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sample Rows */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">First 5 Parsed Rows</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2 font-medium">Rank</th>
                  <th className="text-left py-1.5 px-2 font-medium">Player</th>
                  <th className="text-left py-1.5 px-2 font-medium">Team</th>
                  <th className="text-left py-1.5 px-2 font-medium">Pos</th>
                  <th className="text-right py-1.5 px-2 font-medium">GP</th>
                  <th className="text-right py-1.5 px-2 font-medium">Avg</th>
                  <th className="text-right py-1.5 px-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.sampleRows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 px-2 text-muted-foreground">{row.rank}</td>
                    <td className="py-1.5 px-2 font-medium">{row.name}</td>
                    <td className="py-1.5 px-2">{row.team}</td>
                    <td className="py-1.5 px-2">
                      <Badge variant="outline" className="text-xs">{row.position}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-right">{row.gp}</td>
                    <td className="py-1.5 px-2 text-right">{row.avg.toFixed(1)}</td>
                    <td className="py-1.5 px-2 text-right font-medium">{row.total.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Duplicates */}
      <Card className={hasDuplicates ? "border-yellow-500/30" : ""}>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">
            Duplicate Players: {data.duplicateCount}
          </CardTitle>
        </CardHeader>
        {hasDuplicates && (
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-1.5">
              {data.duplicateNames.map((name, i) => (
                <Badge key={i} variant="destructive" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Duplicates will be handled via UPSERT (last occurrence wins).
            </p>
          </CardContent>
        )}
      </Card>

      {/* Validation Issues */}
      <Card className={hasIssues ? "border-red-500/30" : ""}>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">
            Validation Issues: {data.validationIssues.length}
          </CardTitle>
        </CardHeader>
        {hasIssues && (
          <CardContent className="px-4 pb-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 px-2 font-medium">Row</th>
                    <th className="text-left py-1.5 px-2 font-medium">Field</th>
                    <th className="text-left py-1.5 px-2 font-medium">Value</th>
                    <th className="text-left py-1.5 px-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.validationIssues.slice(0, 20).map((issue, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 px-2">{issue.row}</td>
                      <td className="py-1.5 px-2 font-medium">{issue.field}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{issue.value}</td>
                      <td className="py-1.5 px-2 text-red-600">{issue.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.validationIssues.length > 20 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing first 20 of {data.validationIssues.length} issues.
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </CardContent>
    </Card>
  );
}
