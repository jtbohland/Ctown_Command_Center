import { useEffect, useRef, memo } from "react";

/**
 * SirenCelebration: Renders a 5-second police siren light effect
 * (rotating red glow around screen edges) plus an emoji confetti burst.
 *
 * Emojis: 60% 🚨, 20% 🏈, 20% 🫱🏻‍🫲🏽
 */

const DURATION = 5000;
const EMOJI_COUNT = 60;
const EMOJIS = [
  ...Array(36).fill("🚨"),    // 60%
  ...Array(12).fill("🏈"),    // 20%
  ...Array(12).fill("🫱🏻‍🫲🏽"), // 20%
];

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

const SirenCelebration = memo(function SirenCelebration({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const animFrameRef = useRef<number>();

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;

    // Launch emoji confetti
    for (let i = 0; i < EMOJI_COUNT; i++) {
      const el = document.createElement("div");
      el.textContent = randomEmoji();
      el.style.cssText = `
        position: fixed;
        left: ${Math.random() * 100}vw;
        top: -40px;
        font-size: ${16 + Math.random() * 24}px;
        z-index: 10001;
        pointer-events: none;
        animation: siren-confetti-fall ${2 + Math.random() * 3}s ease-in forwards;
        animation-delay: ${Math.random() * 1.5}s;
        opacity: 0;
      `;
      container.appendChild(el);
    }

    // Auto-cleanup
    timerRef.current = setTimeout(() => {
      onComplete();
    }, DURATION);

    return () => {
      clearTimeout(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [active, onComplete]);

  if (!active) return null;

  return (
    <>
      {/* CSS for confetti animation + siren glow */}
      <style>{`
        @keyframes siren-confetti-fall {
          0% {
            opacity: 1;
            transform: translateY(0) rotate(0deg);
          }
          100% {
            opacity: 0;
            transform: translateY(110vh) rotate(${360 + Math.random() * 720}deg);
          }
        }

        @keyframes siren-rotate {
          0% { opacity: 0.9; box-shadow: inset 0 80px 120px -40px rgba(220,38,38,0.5), inset 80px 0 120px -40px transparent, inset 0 -80px 120px -40px transparent, inset -80px 0 120px -40px transparent; }
          25% { opacity: 0.9; box-shadow: inset 0 80px 120px -40px transparent, inset 80px 0 120px -40px rgba(220,38,38,0.5), inset 0 -80px 120px -40px transparent, inset -80px 0 120px -40px transparent; }
          50% { opacity: 0.9; box-shadow: inset 0 80px 120px -40px transparent, inset 80px 0 120px -40px transparent, inset 0 -80px 120px -40px rgba(220,38,38,0.5), inset -80px 0 120px -40px transparent; }
          75% { opacity: 0.9; box-shadow: inset 0 80px 120px -40px transparent, inset 80px 0 120px -40px transparent, inset 0 -80px 120px -40px transparent, inset -80px 0 120px -40px rgba(220,38,38,0.5); }
          100% { opacity: 0.9; box-shadow: inset 0 80px 120px -40px rgba(220,38,38,0.5), inset 80px 0 120px -40px transparent, inset 0 -80px 120px -40px transparent, inset -80px 0 120px -40px transparent; }
        }

        @keyframes siren-fade-out {
          0% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Rotating red siren glow overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          pointerEvents: "none",
          animation: `siren-rotate 0.8s linear infinite, siren-fade-out ${DURATION}ms ease-in forwards`,
        }}
      />

      {/* Confetti container */}
      <div ref={containerRef} style={{ position: "fixed", inset: 0, zIndex: 10001, pointerEvents: "none" }} />
    </>
  );
});

export default SirenCelebration;
