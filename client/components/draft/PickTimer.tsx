import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type PickTimerProps = {
  isMyPick: boolean;
  currentPickId: number | null;
  currentOverallPick?: number;
  onFirstPickStart?: () => void;
};

const DEFAULT_SECONDS = 300; // 5 minutes

/**
 * Returns an HSL color string that smoothly transitions:
 *   100% time → green (hsl 130)
 *   50% time  → yellow (hsl 45)
 *   0% time   → red (hsl 0)
 */
function timerColor(pct: number): string {
  // Clamp 0–1
  const t = Math.max(0, Math.min(1, pct));
  // Map: 0→0 (red), 0.5→45 (yellow), 1→130 (green)
  let hue: number;
  if (t >= 0.5) {
    // yellow → green
    hue = 45 + ((t - 0.5) / 0.5) * 85;
  } else {
    // red → yellow
    hue = (t / 0.5) * 45;
  }
  return `hsl(${Math.round(hue)}, 90%, 55%)`;
}

function timerBorderColor(pct: number): string {
  const t = Math.max(0, Math.min(1, pct));
  let hue: number;
  if (t >= 0.5) {
    hue = 45 + ((t - 0.5) / 0.5) * 85;
  } else {
    hue = (t / 0.5) * 45;
  }
  return `hsl(${Math.round(hue)}, 80%, 35%)`;
}

function timerBgColor(pct: number): string {
  const t = Math.max(0, Math.min(1, pct));
  let hue: number;
  if (t >= 0.5) {
    hue = 45 + ((t - 0.5) / 0.5) * 85;
  } else {
    hue = (t / 0.5) * 45;
  }
  return `hsla(${Math.round(hue)}, 80%, 40%, 0.12)`;
}

const PickTimer = memo(function PickTimer({ isMyPick, currentPickId, currentOverallPick, onFirstPickStart }: PickTimerProps) {
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTriggeredFirstPickRef = useRef(false);

  // Reset timer when pick changes
  useEffect(() => {
    setSeconds(DEFAULT_SECONDS);
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [currentPickId]);

  // Timer tick
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          setRunning(false);
          // Play alert sound
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            gain.gain.value = 0.3;
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
          } catch {
            // audio not available
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const toggleTimer = useCallback(() => {
    if (seconds === 0) {
      setSeconds(DEFAULT_SECONDS);
      setRunning(true);
    } else {
      const willRun = !running;
      setRunning(willRun);
      // Fire once when pick-1 timer starts
      if (willRun && currentOverallPick === 1 && !hasTriggeredFirstPickRef.current) {
        hasTriggeredFirstPickRef.current = true;
        onFirstPickStart?.();
      }
    }
  }, [seconds, running, currentOverallPick, onFirstPickStart]);

  const resetTimer = useCallback(() => {
    setSeconds(DEFAULT_SECONDS);
    setRunning(false);
  }, []);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const pct = seconds / DEFAULT_SECONDS; // 1 = full, 0 = expired
  const isLow = seconds <= 30 && seconds > 0;
  const isExpired = seconds === 0;

  const color = isExpired ? "hsl(0, 90%, 55%)" : timerColor(pct);
  const borderColor = isExpired ? "hsl(0, 80%, 35%)" : timerBorderColor(pct);
  const bgColor = isExpired ? "hsla(0, 80%, 40%, 0.15)" : timerBgColor(pct);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-500",
        isLow && "animate-pulse",
      )}
      style={{
        borderColor,
        backgroundColor: bgColor,
      }}
    >
      <div
        className="text-lg font-mono font-bold tabular-nums leading-none transition-colors duration-500"
        style={{ color }}
      >
        {minutes}:{String(secs).padStart(2, "0")}
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleTimer}
          title={running ? "Pause" : "Start"}
        >
          <Icon icon={running ? "pause" : "play"} className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={resetTimer}
          title="Reset"
        >
          <Icon icon="rotate-ccw" className="h-3 w-3" />
        </Button>
      </div>
      {isMyPick && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
          Your Pick
        </span>
      )}
    </div>
  );
});

export default PickTimer;
