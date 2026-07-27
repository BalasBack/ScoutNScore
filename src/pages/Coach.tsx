import { useEffect, useRef, useState } from "react";
import {
  Send,
  Bot,
  User,
  Plus,
  MessageSquare,
  Trash2,
  PanelLeft,
} from "lucide-react";
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
  webCoachStream,
} from "../lib/web-llm-client";
import {
  CoachChatRecord,
  createCoachChat,
  deleteCoachChat,
  listCoachChats,
  saveCoachChat,
} from "../lib/web/db";
import { Button, Input } from "../components/ui";

const SUGGESTIONS = [
  "What are my biggest weaknesses based on my games?",
  "What openings should I focus on this week?",
  "How should I prepare for a USCF rapid tournament?",
  "Give me a 7-day training plan before my next event.",
];

function pickModel(status: OllamaStatus, preferred: string | null): string {
  if (!status.models.length) return preferred ?? "llama3.1";
  if (
    preferred &&
    status.models.some((m) => m === preferred || m.startsWith(`${preferred}:`))
  ) {
    return status.models.find(
      (m) => m === preferred || m.startsWith(`${preferred}:`),
    )!;
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
  const [warming, setWarming] = useState(false);
  const [chats, setChats] = useState<CoachChatRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<string>("No games imported yet.");
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    void (async () => {
      let existing = await listCoachChats();
      if (existing.length === 0) {
        const created = await createCoachChat();
        existing = [created];
      }
      setChats(existing);
      setActiveId(existing[0].id);
      setMessages(existing[0].messages);
    })();

    if (web) {
      checkWebCoach().then(setStatus);
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

  const refreshChats = async (preferId?: string | null) => {
    const existing = await listCoachChats();
    setChats(existing);
    const id = preferId ?? activeIdRef.current;
    const pick = existing.find((c) => c.id === id) ?? existing[0] ?? null;
    if (pick) {
      setActiveId(pick.id);
      setMessages(pick.messages);
    } else {
      setActiveId(null);
      setMessages([]);
    }
  };

  const newChat = async () => {
    if (loading) return;
    const created = await createCoachChat();
    setChats((prev) => [created, ...prev]);
    setActiveId(created.id);
    setMessages([]);
    setStreamText("");
    setInput("");
  };

  const selectChat = (id: string) => {
    if (loading || id === activeId) return;
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    setActiveId(id);
    setMessages(chat.messages);
    setStreamText("");
  };

  const removeChat = async (id: string) => {
    if (loading) return;
    await deleteCoachChat(id);
    const remaining = await listCoachChats();
    if (remaining.length === 0) {
      const created = await createCoachChat();
      setChats([created]);
      setActiveId(created.id);
      setMessages([]);
      return;
    }
    setChats(remaining);
    if (activeId === id) {
      setActiveId(remaining[0].id);
      setMessages(remaining[0].messages);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || loading || warming) return;
    if (!status?.connected) return;

    let chatId = activeId;
    if (!chatId) {
      const created = await createCoachChat();
      chatId = created.id;
      setActiveId(created.id);
      setChats((prev) => [created, ...prev]);
    }

    const userMsg: CoachMessage = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    setStreamText("");

    const draft: CoachChatRecord = {
      id: chatId,
      title: "New chat",
      messages: next,
      created_at: chats.find((c) => c.id === chatId)?.created_at ?? Date.now(),
      updated_at: Date.now(),
    };
    const savedUser = await saveCoachChat(draft);
    setChats((prev) => {
      const others = prev.filter((c) => c.id !== chatId);
      return [savedUser, ...others];
    });

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
      const withAssistant = [
        ...next,
        { role: "assistant", content: reply.trim() },
      ];
      setMessages(withAssistant);
      setStreamText("");
      const saved = await saveCoachChat({
        ...savedUser,
        messages: withAssistant,
      });
      setChats((prev) => {
        const others = prev.filter((c) => c.id !== chatId);
        return [saved, ...others];
      });
    } catch (e) {
      const partial = reply.trim();
      const withAssistant = [
        ...next,
        {
          role: "assistant",
          content: partial
            ? `${partial}\n\n—(stopped: ${e})`
            : `Error: ${e}`,
        },
      ];
      setMessages(withAssistant);
      setStreamText("");
      const saved = await saveCoachChat({
        ...savedUser,
        messages: withAssistant,
      });
      setChats((prev) => {
        const others = prev.filter((c) => c.id !== chatId);
        return [saved, ...others];
      });
    } finally {
      setLoading(false);
      void refreshChats(chatId);
    }
  };

  const canSend = !!status?.connected && !warming;
  const activeTitle =
    chats.find((c) => c.id === activeId)?.title ?? "AI Coach";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          aria-label="Toggle chat history"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{activeTitle}</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {web
              ? "Free coach — chats saved on this device"
              : "Local Ollama coach — chats saved on this device"}
          </p>
        </div>
        <Button type="button" onClick={() => void newChat()} disabled={loading}>
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] sm:w-72">
            <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-muted)]">
              Chat history
            </div>
            <div className="flex-1 overflow-auto p-2">
              {chats.map((c) => (
                <div
                  key={c.id}
                  className={`group mb-1 flex items-center gap-1 rounded-lg ${
                    c.id === activeId
                      ? "bg-[var(--color-surface-2)]"
                      : "hover:bg-[var(--color-surface-2)]/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectChat(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
                    <span className="truncate">{c.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeChat(c.id)}
                    className="mr-1 rounded p-1.5 text-[var(--color-muted)] opacity-70 hover:bg-red-500/10 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {!web && status?.connected && status.models.length > 0 && (
              <div className="border-t border-[var(--color-border)] p-3">
                <label className="mb-1 block text-xs text-[var(--color-muted)]">
                  Model
                </label>
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
              </div>
            )}
          </aside>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {status && !status.connected && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 sm:px-8">
              {status?.error ??
                (web
                  ? "AI coach is temporarily unavailable. Try again in a moment."
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
              Getting a reply…
            </div>
          )}

          <div className="flex-1 overflow-auto px-4 py-6 sm:px-8">
            {messages.length === 0 && !streamText ? (
              <div className="mx-auto max-w-xl space-y-4 pt-8">
                <div className="text-center text-[var(--color-muted)]">
                  <Bot className="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p>Ask your AI coach anything about tournament preparation.</p>
                  <p className="mt-2 text-xs">
                    Past chats stay in the sidebar — start a new one anytime.
                  </p>
                </div>
                <div className="grid gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
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
                      className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-[var(--color-accent)] text-white"
                          : "border border-[var(--color-border)] bg-[var(--color-surface-2)]"
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
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm leading-relaxed">
                      {streamText}
                      <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-[var(--color-accent)]" />
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
      </div>
    </div>
  );
}
