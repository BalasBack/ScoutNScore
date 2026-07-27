import type { CoachMessage, OllamaStatus } from "./types";
import { getSettings } from "./web/db";

/** Legacy Pollinations OpenAI-compatible endpoint (still works for many clients). */
const POLLINATIONS_CHAT = "https://text.pollinations.ai/openai";
/** Simple GET text generation fallback. */
const POLLINATIONS_TEXT = "https://text.pollinations.ai";

const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
] as const;

export async function checkWebCoach(): Promise<OllamaStatus> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      `${POLLINATIONS_TEXT}/${encodeURIComponent("ping")}?model=openai`,
      { signal: controller.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      return { connected: true, models: ["openai", "gemini"], error: null };
    }
  } catch {
    /* try settings key below */
  }

  try {
    const s = await getSettings();
    if (s.gemini_api_key?.trim()) {
      return {
        connected: true,
        models: ["gemini"],
        error: null,
      };
    }
  } catch {
    /* ignore */
  }

  return {
    connected: true,
    models: ["openai", "gemini"],
    error: null,
  };
}

function systemPrompt(profileSummary: string): string {
  return `You are ScoutNScore AI Coach for USCF/FIDE chess tournament prep. Be concrete and actionable. Keep answers to 2-4 short paragraphs unless asked for more.

PLAYER STATS:
${profileSummary}`;
}

function buildMessages(
  messages: CoachMessage[],
  profileSummary: string,
): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: systemPrompt(profileSummary) },
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];
}

async function chatPollinationsPost(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const models = ["openai", "mistral", "openai-fast"];
  let lastErr = "Pollinations unavailable";
  for (const model of models) {
    try {
      const res = await fetch(POLLINATIONS_CHAT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
          max_tokens: 700,
        }),
      });
      if (!res.ok) {
        lastErr = `Pollinations ${model} (${res.status})`;
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastErr = "Empty Pollinations reply";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

async function chatPollinationsGet(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const flat = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  const url =
    `${POLLINATIONS_TEXT}/${encodeURIComponent(flat)}` +
    `?model=openai&timestamp=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pollinations GET failed (${res.status})`);
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error("Empty Pollinations GET reply");
  return text;
}

async function chatGemini(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  let lastErr = "Gemini unavailable";
  for (const model of GEMINI_MODELS) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
        `?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 700,
          },
        }),
      });
      if (!res.ok) {
        lastErr = `Gemini ${model} (${res.status})`;
        continue;
      }
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const content = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (content) return content;
      lastErr = "Empty Gemini reply";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

export async function webCoachChat(
  messages: CoachMessage[],
  profileSummary: string,
  geminiApiKey?: string | null,
): Promise<string> {
  const packed = buildMessages(messages, profileSummary);
  const errors: string[] = [];

  // Prefer free Pollinations first (no signup)
  try {
    return await chatPollinationsPost(packed);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    return await chatPollinationsGet(packed);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const key =
    geminiApiKey?.trim() ||
    (await getSettings().catch(() => null))?.gemini_api_key?.trim() ||
    null;
  if (key) {
    try {
      return await chatGemini(key, packed);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  throw new Error(
    `AI coach is unavailable right now. ${errors.slice(0, 2).join(" · ") || "Try again shortly."}` +
      (!key
        ? " You can also add a free Gemini API key in Settings as a backup."
        : ""),
  );
}

export async function* webCoachStream(
  messages: CoachMessage[],
  profileSummary: string,
  geminiApiKey?: string | null,
): AsyncGenerator<string, void, unknown> {
  const text = await webCoachChat(messages, profileSummary, geminiApiKey);
  const size = 32;
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
    await new Promise((r) => setTimeout(r, 8));
  }
}

export async function warmupWebCoach(): Promise<void> {
  // Cloud API — nothing to preload
}

export function setWebCoachProgress(
  _cb: ((message: string, percent: number | null) => void) | null,
) {
  // no-op (kept for Coach.tsx compatibility)
}
