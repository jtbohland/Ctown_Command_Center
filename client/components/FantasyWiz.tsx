import { useState, useCallback, useRef, useEffect, memo } from "react";
import { useApi } from "@/hooks/useApi.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, X, Minimize2, Maximize2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_PROMPTS = [
  "Who's won the most trades this season?",
  "Which managers overpay for RBs?",
  "Best value picks in the last 3 drafts?",
  "Biggest steal and biggest bust trade ever?",
];

const MarkdownMessage = memo(({ content }: { content: string }) => {
  // Simple markdown rendering: bold, headers, lists, code
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-0.5 my-1">
          {listBuffer.map((item, i) => (
            <li key={i} className="text-xs text-zinc-300">{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  const renderInline = (text: string): React.ReactNode => {
    // Bold
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      listBuffer.push(trimmed.slice(2));
    } else {
      flushList();
      if (trimmed.startsWith("### ")) {
        elements.push(<p key={i} className="text-xs font-bold text-amber-400 mt-2 mb-0.5">{trimmed.slice(4)}</p>);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<p key={i} className="text-sm font-bold text-amber-400 mt-2 mb-0.5">{trimmed.slice(3)}</p>);
      } else if (trimmed === "") {
        elements.push(<div key={i} className="h-1.5" />);
      } else {
        elements.push(<p key={i} className="text-xs text-zinc-300 leading-relaxed">{renderInline(trimmed)}</p>);
      }
    }
  });
  flushList();
  return <>{elements}</>;
});
MarkdownMessage.displayName = "MarkdownMessage";

export default function FantasyWiz() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { run: askWiz, loading } = useApi("FantasyWiz");

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setInputValue("");

    try {
      const result = await askWiz({
        prompt: text.trim(),
        conversationHistory: messages.slice(-10), // last 10 for context window
      });
      if (result?.answer) {
        setMessages((prev) => [...prev, { role: "assistant", content: result.answer }]);
      }
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Error: ${msg}` }]);
    }
  }, [loading, messages, askWiz]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  }, [inputValue, sendMessage]);

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full
                   bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm
                   shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40
                   hover:scale-105 transition-all duration-200 border border-purple-400/30"
      >
        <span className="text-lg">🧙🏻‍♂️</span>
        <span>Fantasy Wiz</span>
      </button>
    );
  }

  const panelWidth = isExpanded ? "w-[640px]" : "w-[420px]";
  const panelHeight = isExpanded ? "h-[600px]" : "h-[460px]";

  return (
    <div className={`fixed bottom-5 right-5 z-50 ${panelWidth} ${panelHeight} flex flex-col
                     bg-zinc-900 border border-purple-500/30 rounded-xl shadow-2xl shadow-purple-500/10
                     transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-700/50
                      bg-gradient-to-r from-indigo-900/50 to-purple-900/50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧙🏻‍♂️</span>
          <span className="font-bold text-sm text-white">Fantasy Wiz</span>
          <span className="text-[10px] text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded-full border border-purple-500/30">AI</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setIsOpen(false)}
            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-zinc-700">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="text-4xl">🧙🏻‍♂️</div>
            <div>
              <p className="text-sm font-bold text-white">Ask me anything about C-Town</p>
              <p className="text-xs text-zinc-400 mt-1">Trades, ADP, player performance, manager tendencies, predictions…</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
              {STARTER_PROMPTS.map((p) => (
                <button key={p} onClick={() => sendMessage(p)}
                  className="text-[11px] text-left text-zinc-300 bg-zinc-800 hover:bg-zinc-700
                             border border-zinc-700 hover:border-purple-500/40 rounded-lg px-3 py-2
                             transition-colors leading-snug">
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
              msg.role === "user"
                ? "bg-indigo-600/80 text-white text-xs"
                : "bg-zinc-800 border border-zinc-700/50"
            }`}>
              {msg.role === "assistant" ? (
                <MarkdownMessage content={msg.content} />
              ) : (
                <p className="text-xs leading-relaxed">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 border border-zinc-700/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">🧙🏻‍♂️</span>
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-[10px] text-zinc-500">Consulting the crystal ball…</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-zinc-700/50 bg-zinc-900/80">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Wiz anything…"
            disabled={loading}
            className="flex-1 h-9 text-xs bg-zinc-800 border-zinc-700 focus:border-purple-500"
          />
          <Button
            size="sm"
            onClick={() => sendMessage(inputValue)}
            disabled={!inputValue.trim() || loading}
            className="h-9 w-9 p-0 bg-purple-600 hover:bg-purple-500"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
