import { useState, useEffect, useCallback, memo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ─── Emoji Confetti ─────────────────────────────────────────
const EMOJIS = ["🏈", "🎉", "🏆", "⭐", "🔥", "💪", "🎊", "👑", "🥇", "🍻"];
const CONFETTI_COUNT = 30;

function ConfettiPiece({ emoji, delay, left }: { emoji: string; delay: number; left: number }) {
  return (
    <span
      className="absolute text-2xl pointer-events-none animate-confetti-fall"
      style={{
        left: `${left}%`,
        animationDelay: `${delay}s`,
        top: "-30px",
      }}
    >
      {emoji}
    </span>
  );
}

const confettiPieces = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
  id: i,
  emoji: EMOJIS[i % EMOJIS.length],
  delay: Math.random() * 2.5,
  left: Math.random() * 100,
}));

// localStorage key includes draft year so future drafts get a fresh modal
const DISMISS_KEY = "ctown-draft-celebration-dismissed-2026";

// ─── Celebration Modal ──────────────────────────────────────
type DraftCelebrationProps = {
  isDraftComplete: boolean;
  onGoToRecap?: () => void;
};

const DraftCelebration = memo(function DraftCelebration({ isDraftComplete, onGoToRecap }: DraftCelebrationProps) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "true"; } catch { return false; }
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "true"); } catch { /* noop */ }
  }, []);

  const handleRecap = useCallback(() => {
    dismiss();
    onGoToRecap?.();
  }, [dismiss, onGoToRecap]);

  const open = isDraftComplete && !dismissed;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) dismiss(); }}>
      <DialogContent className="sm:max-w-md border-amber-500/30 bg-gradient-to-b from-card to-card/95 overflow-hidden">
        {/* Confetti container */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {confettiPieces.map((p) => (
            <ConfettiPiece key={p.id} emoji={p.emoji} delay={p.delay} left={p.left} />
          ))}
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center gap-4 py-4">
          <span className="text-6xl animate-bounce">🏆</span>
          <h2 className="text-2xl font-black tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            Draft Complete!
          </h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            All picks are in! The C-Town Redux Season XX rosters are set.
            Head to <strong>Recap</strong> to see the grades and analysis.
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={dismiss}
            >
              Close
            </Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
              onClick={handleRecap}
            >
              Redux Recap
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default DraftCelebration;
