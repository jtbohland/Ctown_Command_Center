import { useState, useEffect, useMemo, memo } from "react";
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

// ─── Celebration Modal ──────────────────────────────────────
type DraftCelebrationProps = {
  isDraftComplete: boolean;
};

const DraftCelebration = memo(function DraftCelebration({ isDraftComplete }: DraftCelebrationProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);

  // Only trigger once when draft transitions to complete
  useEffect(() => {
    if (isDraftComplete && !hasTriggered) {
      setHasTriggered(true);
    }
  }, [isDraftComplete, hasTriggered]);

  const open = hasTriggered && !dismissed;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && setDismissed(true)}>
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
              onClick={() => setDismissed(true)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default DraftCelebration;
