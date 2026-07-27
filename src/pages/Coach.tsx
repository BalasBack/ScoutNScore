import { useEffect, useRef, useState } from "react";
import { Send, Bot, User } from "lucide-react";
import { api, CoachMessage, OllamaStatus } from "../lib/tauri";
import { isWebApp } from "../lib/api";
import {
  checkOllama,
  coachChatStream,
  formatCoachProfile,
  warmupModel,
} from "../lib/ollama-client";
import {
  checkWebCoach,
  setCoachProfileCache,
  warmupWebCoach,
  webCoachStream,
} from "../lib/web-llm-client";
import { Button, Card, Input } from "../components/ui";

const SUGGESTIONS = [
  "What are my biggest weaknesses based on my games?",
  "What openings should I focus on this week?",
  "How should I prepare for a USCF rapid tournament?",
  "Give me a 7-day training plan before my next event.",
];

function pickModel(status: OllamaStatus, preferred: string | null): string {
  if (!status.models.length) return preferred ?? "llama3.1";
  if (preferred && status.models.some((m) => m === preferred || m.startsWith(`${preferred}:`))) {
    return status.models.find((m) => m === preferred || m.startsWith(`${preferred}:`))!;
  }
  const small = status.models.find((m) =>
    /phi|gemma|:1b|:3b|mini|small/i.test(m),
  );
  return small ?? status.models[0];
}

export function Coach() {
  const web = isWebApp();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [model, setModel] = useState("llama3.1");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [warming, setWarming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<string>("No games imported yet.");

  useEffect(() => {
    if (web) {
      checkWebCoach().then(setStatus);
      void warmupWebCoach();
      api.getPlayerStats().then((stats) => {
        profileRef.current = formatCoachProfile(stats);
        setCoachProfileCache(profileRef.current);
      });
      return;
    }

    Promise.all([checkOllama(), api.getSettings()]).then(([ollama, settings]) => {
      setStatus(ollama);
      const picked = pickModel(ollama, settings.ollama_model);
      setModel(picked);
      if (ollama.connected) {
        setWarming(true);
        warmupModel(picked).finally(() => setWarming(false));
      }
    });
  }, [web]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText, loading, warming]);

  const send = async (text: string) => {
    if (!text.trim() || loading || warming) return;
    if (!status?.connected) return;

    const userMsg: CoachMessage = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    setStreamText("");

    let reply = "";
    try {
      const stream = web
        ? webCoachStream(next, profileRef.current)
        : coachChatStream(
            model,
            next,
            formatCoachProfile(await api.getPlayerStats()),
          );
      for await (const chunk of stream) {
        reply += chunk;
        setStreamText(reply);
      }
      setMessages([...next, { role: "assistant", content: reply.trim() }]);
      setStreamText("");
    } catch (e) {
      const partial = reply.trim();
      setMessages([
        ...next,
        {
          role: "assistant",
          content: partial
            ? `${partial}\n\n—(stopped: ${e})`
            : `Error: ${e}`,
        },
      ]);
      setStreamText("");
    } finally {
      setLoading(false);
    }
  };

  const canSend = !!status?.connected && !warming;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-[var(--color-border)] px-4 py-5 sm:px-8">
        <h1 className="text-xl font-bold">AI Coach</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {web
            ? "Fast free cloud coach — no signup or API key"
            : "Local coaching via Ollama — powered by your game stats"}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          {status && !status.connected && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 sm:px-8">
              {status?.error ??
                (web
                  ? "AI coach is temporarily unavailable. Try again in a moment, or use the desktop app with Ollama."
                  : "Ollama not connected. Install from ollama.com and run: ollama pull llama3.1")}
            </div>
          )}

          {warming && (
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-xs text-[var(--color-muted)] sm:px-8">
              Loading model into memory…
            </div>
          )}

          {loading && !streamText && (
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-xs text-[var(--color-muted)] sm:px-8">
              Getting a reply (usually under 10s)…
            </div>
          )}

          <div className="flex-1 overflow-auto px-4 py-6 sm:px-8">
            {messages.length === 0 && !streamText ? (
              <div className="mx-auto max-w-xl space-y-4 pt-8">
                <div className="text-center text-[var(--color-muted)]">
                  <Bot className="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p>Ask your AI coach anything about tournament preparation.</p>
                  {web && (
                    <p className="mt-2 text-xs">
                      Free cloud coach — replies usually arrive in a few seconds.
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={loading || !canSend}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-left text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-4">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}
                  >
                    {m.role === "assistant" && (
                      <Bot className="mt-1 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
                    )}
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-[var(--color-accent)] text-white"
                          : "bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                      }`}
                    >
                      {m.content}
                    </div>
                    {m.role === "user" && (
                      <User className="mt-1 h-5 w-5 shrink-0 text-[var(--color-muted)]" />
                    )}
                  </div>
                ))}
                {streamText && (
                  <div className="flex gap-3">
                    <Bot className="mt-1 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
                    <div className="max-w-[85%] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm leading-relaxed">
                      {streamText}
                      <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-[var(--color-accent)]" />
                    </div>
                  </div>
                )}
                {loading && !streamText && (
                  <div className="flex gap-3">
                    <Bot className="h-5 w-5 text-[var(--color-accent)]" />
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-muted)]">
                      Thinking…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-8">
            <form
              className="mx-auto flex max-w-2xl gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask your coach..."
                disabled={loading || !canSend}
              />
              <Button
                type="submit"
                loading={loading}
                disabled={!input.trim() || loading || !canSend}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>

        <aside className="shrink-0 space-y-4 border-t border-[var(--color-border)] p-4 lg:w-64 lg:border-l lg:border-t-0">
          <Card title={web ? "Cloud coach" : "Model"}>
            {web ? (
              <p className="text-xs text-[var(--color-muted)]">
                {status?.connected
                  ? "Ready — no signup required"
                  : status
                    ? "Unavailable"
                    : "Checking…"}
              </p>
            ) : status?.connected && status.models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setWarming(true);
                  warmupModel(e.target.value).finally(() => setWarming(false));
                }}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-sm"
              >
                {status.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">
                Connect Ollama to select a model
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
