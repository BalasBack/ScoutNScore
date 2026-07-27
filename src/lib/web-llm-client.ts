import type { CoachMessage, OllamaStatus } from "./types";

/** Free anonymous Pollinations endpoints (no API key). */
const CHAT_URL = "https://text.pollinations.ai/openai";
const TEXT_URL = "https://text.pollinations.ai";

/** Prefer smaller/faster free models; try one-at-a-time to avoid 429 storms. */
const FREE_MODELS = [
  "openai-fast",
  "gemini-fast",
  "nova-fast",
  "mistral",
  "openai",
] as const;

const REQUEST_TIMEOUT_MS = 16_000;
const MAX_OUTPUT_TOKENS = 200;
const MAX_HISTORY = 5;
const MAX_RETRIES_429 = 3;

export function setCoachProfileCache(_summary: string | null) {
  // reserved for future prefetch hooks
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(status: number, message: string): boolean {
  return status === 429 || /429|rate.?limit|too many/i.test(message);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function checkWebCoach(): Promise<OllamaStatus> {
  // Do not ping the free API — pings burn rate limits and cause 429s.
  return { connected: true, models: [...FREE_MODELS], error: null };
}

function systemPrompt(profileSummary: string): string {
  return `Chess coach. Max 2 short paragraphs. Concrete tips only.

PLAYER:
${profileSummary.slice(0, 900)}`;
}

function buildMessages(
  messages: CoachMessage[],
  profileSummary: string,
): Array<{ role: string; content: string }> {
  const recent = messages.slice(-MAX_HISTORY);
  return [
    { role: "system", content: systemPrompt(profileSummary) },
    ...recent.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, 1500),
    })),
  ];
}

function parseChatJson(data: unknown): string | null {
  const d = data as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  return (
    d.choices?.[0]?.message?.content?.trim() ||
    d.choices?.[0]?.text?.trim() ||
    null
  );
}

async function postChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean,
): Promise<Response> {
  return fetchWithTimeout(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream,
    }),
  });
}

/** Alternate GET endpoint — often has a separate free quota. */
async function getText(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userParts = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const prompt = userParts.slice(0, 1800);
  const url =
    `${TEXT_URL}/${encodeURIComponent(prompt)}` +
    `?model=${encodeURIComponent(model)}` +
    `&system=${encodeURIComponent(system.slice(0, 800))}`;
  const res = await fetchWithTimeout(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${model} (${res.status})`);
  const text = (await res.text()).trim();
  if (!text) throw new Error(`GET ${model} empty`);
  // Avoid returning HTML error pages
  if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    throw new Error(`GET ${model} bad response`);
  }
  return text;
}

async function withBackoff429<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES_429; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const statusMatch = msg.match(/\((\d{3})\)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (!isRateLimited(status, msg) || attempt === MAX_RETRIES_429 - 1) {
        throw e;
      }
      // Exponential backoff + jitter: ~0.8s, 1.6s, 3.2s
      const wait = 800 * 2 ** attempt + Math.floor(Math.random() * 400);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function chatModelOnce(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await postChat(model, messages, false);
  if (!res.ok) throw new Error(`${model} (${res.status})`);
  const content = parseChatJson(await res.json());
  if (!content) throw new Error(`${model} empty`);
  return content;
}

async function chatModel(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  return withBackoff429(() => chatModelOnce(model, messages));
}

async function* streamModel(
  model: string,
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<string, void, unknown> {
  const res = await withBackoff429(async () => {
    const r = await postChat(model, messages, true);
    if (!r.ok) throw new Error(`${model} stream (${r.status})`);
    return r;
  });

  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${model} no stream body`);

  const decoder = new TextDecoder();
  let buffer = "";
  let gotContent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string };
            message?: { content?: string };
            text?: string;
          }>;
        };
        const chunk =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content ??
          json.choices?.[0]?.text ??
          "";
        if (chunk) {
          gotContent = true;
          yield chunk;
        }
      } catch {
        /* partial SSE */
      }
    }
  }

  if (!gotContent) throw new Error(`${model} empty stream`);
}

/** Try free models sequentially; on failure try GET endpoint for that model. */
async function freeCoachReply(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const errors: string[] = [];
  for (const model of FREE_MODELS) {
    try {
      return await chatModel(model, messages);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    try {
      return await withBackoff429(() => getText(model, messages));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(
    "The free coach is busy right now. Wait a few seconds and try again.",
  );
}

export async function webCoachChat(
  messages: CoachMessage[],
  profileSummary: string,
): Promise<string> {
  return freeCoachReply(buildMessages(messages, profileSummary));
}

export async function* webCoachStream(
  messages: CoachMessage[],
  profileSummary: string,
): AsyncGenerator<string, void, unknown> {
  const packed = buildMessages(messages, profileSummary);

  for (const model of FREE_MODELS) {
    try {
      yield* streamModel(model, packed);
      return;
    } catch {
      /* try next model / non-stream */
    }
  }

  const text = await freeCoachReply(packed);
  yield text;
}

export async function warmupWebCoach(): Promise<void> {
  // Intentionally empty — warmup burned free-tier rate limits (429).
}

export function setWebCoachProgress(
  _cb: ((message: string, percent: number | null) => void) | null,
) {
  // no-op
}
