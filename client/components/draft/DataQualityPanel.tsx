import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/useApi.js";

interface CheckResult {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface QualityReport {
  checks: CheckResult[];
  passCount: number;
  warnCount: number;
  failCount: number;
  runAt: string;
}

const STATUS_CONFIG = {
  pass: { icon: "✅", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  warn: { icon: "⚠️", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  fail: { icon: "❌", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
} as const;

export default function DataQualityPanel() {
  const { run: runChecks, loading, data, error } = useApi("DataQualityCheck");
  const [report, setReport] = useState<QualityReport | null>(null);

  const handleRun = useCallback(async () => {
    try {
      const result = await runChecks({});
      if (result) {
        setReport(result as QualityReport);
      }
    } catch {
      // error is available via the hook
    }
  }, [runChecks]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔬</span>
          <span className="text-sm font-bold">Data Quality Scanner</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 border-blue-500/30 text-blue-400">
            §8
          </Badge>
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          {loading ? "Scanning…" : report ? "Re-scan" : "Run Checks"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Validates ADP, rookie, and trade data integrity against the spec's 12 required checks plus date normalization.
      </p>

      {error != null && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          {`Error running checks: ${error instanceof Error ? error.message : String(error)}`}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center gap-3 text-xs bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
            <span className="text-emerald-400 font-mono font-bold">{report.passCount} pass</span>
            <span className="text-border/50">·</span>
            <span className="text-yellow-400 font-mono font-bold">{report.warnCount} warn</span>
            <span className="text-border/50">·</span>
            <span className="text-red-400 font-mono font-bold">{report.failCount} fail</span>
            <span className="ml-auto text-muted-foreground">
              {new Date(report.runAt).toLocaleTimeString()}
            </span>
          </div>

          {/* Check results */}
          <div className="space-y-1.5">
            {report.checks.map((check) => {
              const cfg = STATUS_CONFIG[check.status];
              return (
                <div
                  key={check.id}
                  className={`rounded-lg border ${cfg.border} ${cfg.bg} px-3 py-2`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5 shrink-0">{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${cfg.color}`}>
                        {check.label}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        {check.detail}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
