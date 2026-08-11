import { useState } from "react";
import { Badge } from "@/components/ui/badge";

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
      title: "The Valuation Formula",
      content: (
        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p className="text-foreground font-medium">
            Every player and pick gets a point value based on ADP (Average Draft Position). 
            Here's how it works:
          </p>

          <div className="bg-muted/30 rounded-lg p-4 border border-border/50 space-y-3">
            <div>
              <div className="text-xs font-bold text-foreground mb-1">Player Value Formula</div>
              <code className="text-xs bg-background/60 px-2 py-1 rounded font-mono">
                Value = 10,000 × (1 / ADP_Rank) ^ 0.6
              </code>
              <p className="text-xs mt-1.5">
                Lower ADP = higher value. The #1 overall pick is worth ~10,000 pts. 
                The curve drops steeply — top-10 picks are worth significantly more than mid-round picks.
              </p>
            </div>

            <div>
              <div className="text-xs font-bold text-foreground mb-1">Draft Pick Value</div>
              <code className="text-xs bg-background/60 px-2 py-1 rounded font-mono">
                Value = PlayerValue(draft_position + 44) × year_discount
              </code>
              <p className="text-xs mt-1.5">
                <span className="text-emerald-400 font-semibold">Keeper offset:</span> In a 4-keeper, 11-team league, 44 players are locked on rosters before the draft. 
                Pick 1.01 targets the 45th-best player (ADP 45), not the 1st. This makes picks worth significantly less than star players — 
                which is why blockbuster trades always involve multiple picks for one elite asset.
              </p>
              <p className="text-xs mt-1">
                Future picks are discounted: 2026 = 100%, 2027 = 80%, 2028 = 65%.
              </p>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-foreground mb-2">How Trades Are Scored</div>
            <p>
              We sum the total value for each side, then calculate the percentage difference between them. 
              That % difference determines the verdict:
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <VerdictExplainer emoji="⚖️" label="Fair Trade" range="0-5%" color="text-emerald-400" description="Both sides are balanced" />
            <VerdictExplainer emoji="📈" label="Slight Edge" range="5-15%" color="text-amber-400" description="One side got a little more" />
            <VerdictExplainer emoji="🏆" label="Clear Winner" range="15-25%" color="text-orange-400" description="Notably lopsided" />
            <VerdictExplainer emoji="🚨" label="Highway Robbery" range="25%+" color="text-red-400" description="Someone got fleeced" />
          </div>

          <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 mt-3">
            <div className="text-xs font-bold text-purple-400 mb-1">📡 Deal Déjà Vu</div>
            <p className="text-xs">
              When you evaluate a trade, the system searches historical trades for similar player/pick combinations 
              and shows you comparable deals from the past — so you can see precedent before making a decision.
            </p>
          </div>
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

function VerdictExplainer({ emoji, label, range, color, description }: { emoji: string; label: string; range: string; color: string; description: string }) {
  return (
    <div className="bg-muted/20 rounded-lg p-2.5 border border-border/50">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{emoji}</span>
        <span className={`text-xs font-bold ${color}`}>{label}</span>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{range} difference</div>
      <div className="text-[10px] text-muted-foreground">{description}</div>
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
