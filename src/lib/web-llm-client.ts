import type { CoachMessage, OllamaStatus } from "./types";

/**
 * Free anonymous Pollinations text API (no API key).
 * Important: anonymous tier allows ~1 concurrent request per IP.
 * Never race parallel calls — that causes queue-full 429s and multi-minute hangs.
 */
const TEXT_URL = "https://text.pollinations.ai";

/** Fast models only — try sequentially, fail fast. */
const FREE_MODELS = ["openai-fast", "mistral", "gemini-fast"] as const;

const ATTEMPT_MS = 7_000;
const OVERALL_MS = 15_000;
const MAX_HISTORY = 4;
const MAX_PROMPT = 1600;

/** Serialize all coach network calls (1-at-a-time per app session). */
let flight: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = flight.then(fn, fn);
  flight = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function setCoachProfileCache(_summary: string | null) {
  // reserved
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
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
  return { connected: true, models: [...FREE_MODELS], error: null };
}

function systemPrompt(profileSummary: string): string {
  return `You are a chess coach. Reply in at most 2 short paragraphs. Concrete tips only. No fluff.

PLAYER STATS:
${profileSummary.slice(0, 700)}`;
}

function buildPrompt(
  messages: CoachMessage[],
  profileSummary: string,
): string {
  const recent = messages.slice(-MAX_HISTORY);
  const dialogue = recent
    .map((m) => `${m.role === "assistant" ? "Coach" : "Player"}: ${m.content.slice(0, 800)}`)
    .join("\n");
  return `${systemPrompt(profileSummary)}\n\n${dialogue}\nCoach:`.slice(
    0,
    MAX_PROMPT,
  );
}

function cleanReply(text: string): string {
  let t = text.trim();
  // Strip occasional upstream ads / notices
  t = t.replace(/https?:\/\/enter\.pollinations\.ai\S*/gi, "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) {
    throw new Error("bad HTML response");
  }
  if (!t) throw new Error("empty");
  return t;
}

/** GET transport — fastest anonymous path; pack system into the prompt (no system= query). */
async function getText(model: string, prompt: string): Promise<string> {
  const url =
    `${TEXT_URL}/${encodeURIComponent(prompt)}` +
    `?model=${encodeURIComponent(model)}` +
    `&temperature=0.4`;
  const res = await fetchWithTimeout(url, { method: "GET" }, ATTEMPT_MS);
  if (res.status === 429) throw new Error(`${model} busy (429)`);
  if (!res.ok) throw new Error(`${model} (${res.status})`);
  return cleanReply(await res.text());
}

function localFallback(
  profileSummary: string,
  lastUser: string,
): string {
  const tip =
    profileSummary && profileSummary !== "No games imported yet."
      ? `From your imported games: ${profileSummary.slice(0, 280).replace(/\s+/g, " ")}…`
      : "Import Lichess/Chess.com games so coaching tips can use your real stats.";
  return (
    `Cloud coach is crowded right now, so here's a quick local tip while you retry in a few seconds.\n\n` +
    `${tip}\n\n` +
    `For “${lastUser.slice(0, 80)}”: focus on one opening as White, one defense as Black, ` +
    `and 15 minutes of tactics daily before your next tournament.`
  );
}

async function freeCoachReply(
  messages: CoachMessage[],
  profileSummary: string,
): Promise<string> {
  const prompt = buildPrompt(messages, profileSummary);
  const started = Date.now();
  const errors: string[] = [];

  return enqueue(async () => {
    for (const model of FREE_MODELS) {
      if (Date.now() - started > OVERALL_MS - 500) break;
      try {
        return await getText(model, prompt);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        // Brief pause only after rate-limit so the 1-slot queue can clear
        if (/429|busy/i.test(String(e))) await sleep(600);
      }
    }

    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content ??
      "tournament prep";
    return localFallback(profileSummary, lastUser);
  });
}

export async function webCoachChat(
  messages: CoachMessage[],
  profileSummary: string,
): Promise<string> {
  return freeCoachReply(messages, profileSummary);
}

/**
 * Yields as soon as a reply is ready (usually one chunk).
 * Avoids streaming hang: anonymous Pollinations streams often stall with no tokens.
 */
export async function* webCoachStream(
  messages: CoachMessage[],
  profileSummary: string,
): AsyncGenerator<string, void, unknown> {
  const text = await freeCoachReply(messages, profileSummary);
  yield text;
}

export async function warmupWebCoach(): Promise<void> {
  // no-op — warmup burns the single free concurrent slot
}

export function setWebCoachProgress(
  _cb: ((message: string, percent: number | null) => void) | null,
) {
  // no-op
}
