import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import FormulaDeepDive from "./FormulaDeepDive";
import { SLIDER_CONFIGS, CATEGORY_LABELS, DEFAULT_MODIFIERS } from "@/lib/trade-modifiers";

export default function Playbook() {
  const [expanded, setExpanded] = useState<string | null>("overview");

  const sections = [
    {
      id: "overview",
      icon: "🛋️",
      title: "What is the Arm Chair Dealer?",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <span className="text-foreground font-semibold">Arm Chair Dealer</span> is your dynasty fantasy football trade command center. 
            It evaluates trades using ADP-based player valuations, tracks every trade in league history, and helps you 
            make informed decisions before pulling the trigger on a deal.
          </p>
          <p>
            Whether you're proposing a blockbuster, logging a league trade, or studying historical patterns — 
            this is where deals get dissected.
          </p>
        </div>
      ),
    },
    {
      id: "tabs",
      icon: "📑",
      title: "Tab Guide",
      content: (
        <div className="space-y-4 text-sm">
          <TabExplainer
            emoji="⚖️"
            name="Deal Desk"
            description="Build and evaluate trades in real-time. Select two teams, add players and picks to each side, and get an instant valuation verdict. See exactly how much each side is giving up."
          />
          <TabExplainer
            emoji="📚"
            name="The Ledger"
            description="Complete trade history across all seasons. Every trade ever made, with verdicts, winners, and the full asset breakdown. Filter by season and expand any trade to see the details."
          />
          <TabExplainer
            emoji="🏛️"
            name="The Verdicts"
            description="All trades categorized by how lopsided they were. See the best, worst, and fairest trades ever made. Filter by season or verdict type. Includes Trade of the Season highlights and a manager leaderboard."
          />
          <TabExplainer
            emoji="🚨"
            name="Sound The Alarm"
            description="Log trades as they happen around the league. When two other teams make a deal, record it here so the system can track and evaluate it alongside everything else."
          />
          <TabExplainer
            emoji="💰"
            name="The Treasury"
            description="Draft capital map showing who owns which picks for upcoming drafts. See which teams are pick-rich and who's been trading futures."
          />
          <TabExplainer
            emoji="📖"
            name="The Playbook"
            description="You're here! This guide explains how everything works, including the formula behind trade valuations."
          />
        </div>
      ),
    },
    {
      id: "formula",
      icon: "🧮",
      title: "How The Formula Works",
      content: <FormulaDeepDive />,
    },
    {
      id: "modifiers",
      icon: "⚙️",
      title: "Customizable Modifiers",
      content: (
        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p>
            The <span className="text-foreground font-semibold">⚙️ Customize Model</span> panel on the Deal Desk tab lets you adjust
            how the Arm Chair Dealer values players and picks. All 11 sliders have sensible defaults based on C-Town league conventions — 
            you only need to touch them if you want to explore "what if" scenarios.
          </p>
          <div className="space-y-3">
            {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
              const configs = SLIDER_CONFIGS.filter((c) => c.category === cat);
              if (configs.length === 0) return null;
              return (
                <div key={cat} className="bg-muted/30 rounded-lg p-3 border border-border/50">
                  <div className="text-xs font-bold text-foreground mb-2">{meta.emoji} {meta.label}</div>
                  <div className="space-y-1.5">
                    {configs.map((c) => (
                      <div key={c.key} className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-foreground min-w-[140px]">{c.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">Default: {c.format(c.defaultValue)}</span>
                        <span className="text-[10px] text-muted-foreground/70">— {c.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground/70">
            Modified sliders show a yellow badge on the panel. Use "🔄 Reset All" to return to league defaults.
          </p>
        </div>
      ),
    },
    {
      id: "tips",
      icon: "💡",
      title: "Pro Tips",
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <Tip text="With the keeper offset, a 1st round pick (ADP ~45-55) is a solid starter, not a league-winner. It takes multiple picks to match an elite player — that's by design." />
          <Tip text="Future year picks are discounted. A 2028 1st round pick is worth ~65% of the same pick this year." />
          <Tip text="Use The Verdicts to study which managers tend to 'win' trades and which ones overpay." />
          <Tip text="Log every trade with Sound The Alarm — the more data, the better Deal Déjà Vu works." />
          <Tip text="Check The Treasury before proposing trades to see who's pick-rich (more willing to trade picks)." />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center py-4">
        <span className="text-4xl">📖</span>
        <h2 className="text-xl font-extrabold mt-2">The Playbook</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Everything you need to know about the Arm Chair Dealer
        </p>
      </div>

      {/* Accordion Sections */}
      {sections.map((section) => {
        const isOpen = expanded === section.id;
        return (
          <div
            key={section.id}
            className={`rounded-xl border transition-all ${isOpen ? "border-border bg-card/50 shadow-sm" : "border-border/50 hover:border-border"}`}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : section.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              <span className="text-xl">{section.icon}</span>
              <span className="text-sm font-bold flex-1">{section.title}</span>
              <span className="text-xs text-muted-foreground">{isOpen ? "▼" : "▶"}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-0">
                {section.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabExplainer({ emoji, name, description }: { emoji: string; name: string; description: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-lg mt-0.5">{emoji}</span>
      <div>
        <div className="font-semibold text-foreground text-sm">{name}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}


function Tip({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-start">
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400 shrink-0 mt-0.5">TIP</Badge>
      <p className="text-xs">{text}</p>
    </div>
  );
}
