import { useState, useCallback, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type TradeModifiers,
  DEFAULT_MODIFIERS,
  SLIDER_CONFIGS,
  CATEGORY_LABELS,
  type SliderConfig,
} from "@/lib/trade-modifiers";

interface Props {
  modifiers: TradeModifiers;
  onChange: (modifiers: TradeModifiers) => void;
}

function SliderRow({ config, value, onChange }: { config: SliderConfig; value: number; onChange: (v: number) => void }) {
  const isDefault = Math.abs(value - config.defaultValue) < 0.001;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">{config.label}</label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted-foreground min-w-[60px] text-right">
            {config.format(value)}
          </span>
          {!isDefault && (
            <button
              onClick={() => onChange(config.defaultValue)}
              className="text-[9px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted/50 transition-colors"
              title="Reset to default"
            >
              ↩
            </button>
          )}
        </div>
      </div>
      <Slider
        min={config.min}
        max={config.max}
        step={config.step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <p className="text-[10px] text-muted-foreground/70">{config.description}</p>
    </div>
  );
}

export default function ModelCustomizer({ modifiers, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const ADVANCED_CATEGORIES = new Set(["model", "verdict", "fallback"]);

  const modifiedCount = useMemo(() => {
    return SLIDER_CONFIGS.filter(
      (c) => Math.abs(modifiers[c.key] - c.defaultValue) >= 0.001,
    ).length;
  }, [modifiers]);

  const advancedModifiedCount = useMemo(() => {
    return SLIDER_CONFIGS.filter(
      (c) => ADVANCED_CATEGORIES.has(c.category) && Math.abs(modifiers[c.key] - c.defaultValue) >= 0.001,
    ).length;
  }, [modifiers]);

  const handleReset = useCallback(() => {
    onChange({ ...DEFAULT_MODIFIERS });
  }, [onChange]);

  const handleSliderChange = useCallback(
    (key: keyof TradeModifiers, value: number) => {
      onChange({ ...modifiers, [key]: value });
    },
    [modifiers, onChange],
  );

  // Group sliders by category
  const grouped = useMemo(() => {
    const groups: Record<string, SliderConfig[]> = {};
    for (const config of SLIDER_CONFIGS) {
      if (!groups[config.category]) groups[config.category] = [];
      groups[config.category].push(config);
    }
    return groups;
  }, []);

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors"
      >
        <span className="text-base">⚙️</span>
        <span className="text-xs font-bold text-muted-foreground">Customize Model</span>
        {modifiedCount > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
            {modifiedCount} modified
          </Badge>
        )}
        <span className={`ml-auto text-[10px] text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 space-y-5">
          {/* Reset button */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Adjust these sliders to change how The C-Town Exchange values players and picks.
              Defaults are pre-set to the league's standard model.
            </p>
            {modifiedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="text-[10px] h-6 px-2 shrink-0 ml-3"
              >
                🔄 Reset All
              </Button>
            )}
          </div>

          {/* Main slider groups (positional, dynasty, history) */}
          {Object.entries(grouped)
            .filter(([category]) => !ADVANCED_CATEGORIES.has(category))
            .map(([category, configs]) => {
              const meta = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS];
              return (
                <div key={category} className="space-y-3">
                  <div className="flex items-center gap-1.5 border-b border-border/20 pb-1">
                    <span className="text-sm">{meta.emoji}</span>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {meta.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {configs.map((config) => (
                      <SliderRow
                        key={config.key}
                        config={config}
                        value={modifiers[config.key]}
                        onChange={(v) => handleSliderChange(config.key, v)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center gap-2 py-2 px-1 text-left border-t border-border/20 hover:bg-muted/20 rounded transition-colors"
          >
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {showAdvanced ? "▼" : "▶"} Advanced Settings
            </span>
            {advancedModifiedCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
                {advancedModifiedCount} modified
              </Badge>
            )}
          </button>

          {/* Advanced slider groups (model shape, verdict calibration) */}
          {showAdvanced && Object.entries(grouped)
            .filter(([category]) => ADVANCED_CATEGORIES.has(category))
            .map(([category, configs]) => {
              const meta = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS];
              return (
                <div key={category} className="space-y-3">
                  <div className="flex items-center gap-1.5 border-b border-border/20 pb-1">
                    <span className="text-sm">{meta.emoji}</span>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {meta.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {configs.map((config) => (
                      <SliderRow
                        key={config.key}
                        config={config}
                        value={modifiers[config.key]}
                        onChange={(v) => handleSliderChange(config.key, v)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
