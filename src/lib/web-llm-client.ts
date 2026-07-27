import type { CoachMessage, OllamaStatus } from "./types";

/**
 * Free anonymous coach — no user API keys.
 * Pollinations anonymous tier is ~1 concurrent request/IP; keep single-flight.
 */
const POLL_TEXT = "https://text.pollinations.ai";
const POLL_CHAT = "https://text.pollinations.ai/openai";
/** Public keyless OpenAI-compatible proxy (dummy Bearer accepted; not a user key). */
const KEYLESS_CHAT = "https://keylessai.thryx.workers.dev/v1/chat/completions";

const FREE_MODELS = ["openai-fast", "mistral", "gemini-fast"] as const;
const ATTEMPT_MS = 8_000;
const OVERALL_MS = 18_000;
const MAX_HISTORY = 6;
const MAX_PROMPT = 1800;
const MAX_TOKENS = 220;

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
  return `You are ScoutNScore chess coach. Reply in at most 2 short paragraphs. Concrete tips only.

PLAYER:
${profileSummary.slice(0, 800)}`;
}

function buildChatMessages(
  messages: CoachMessage[],
  profileSummary: string,
): Array<{ role: string; content: string }> {
  const recent = messages.slice(-MAX_HISTORY);
  return [
    { role: "system", content: systemPrompt(profileSummary) },
    ...recent.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, 1200),
    })),
  ];
}

function buildGetPrompt(
  messages: CoachMessage[],
  profileSummary: string,
): string {
  const recent = messages.slice(-MAX_HISTORY);
  const dialogue = recent
    .map(
      (m) =>
        `${m.role === "assistant" ? "Coach" : "Player"}: ${m.content.slice(0, 700)}`,
    )
    .join("\n");
  return `${systemPrompt(profileSummary)}\n\n${dialogue}\nCoach:`.slice(
    0,
    MAX_PROMPT,
  );
}

function cleanReply(text: string): string {
  let t = text.trim();
  if (
    t.startsWith("{") &&
    /"error"|"status"\s*:\s*4|"PAYMENT"|"UNAUTHORIZED"/i.test(t)
  ) {
    throw new Error("upstream error JSON");
  }
  t = t.replace(/https?:\/\/enter\.pollinations\.ai\S*/gi, "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) {
    throw new Error("bad HTML response");
  }
  if (!t || t.length < 8) throw new Error("empty");
  return t;
}

function parseOpenAiJson(data: unknown): string {
  const d = data as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  const content =
    d.choices?.[0]?.message?.content?.trim() ||
    d.choices?.[0]?.text?.trim() ||
    "";
  if (!content) throw new Error("empty openai json");
  return cleanReply(content);
}

async function postOpenAi(
  url: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.45,
        max_tokens: MAX_TOKENS,
      }),
    },
    ATTEMPT_MS,
  );
  if (res.status === 429) throw new Error(`${model} busy (429)`);
  if (!res.ok) throw new Error(`${model} (${res.status})`);
  return parseOpenAiJson(await res.json());
}

async function getPollText(model: string, prompt: string): Promise<string> {
  const url =
    `${POLL_TEXT}/${encodeURIComponent(prompt)}` +
    `?model=${encodeURIComponent(model)}` +
    `&temperature=0.45`;
  const res = await fetchWithTimeout(url, { method: "GET" }, ATTEMPT_MS);
  if (res.status === 429) throw new Error(`${model} busy (429)`);
  if (!res.ok) throw new Error(`${model} GET (${res.status})`);
  return cleanReply(await res.text());
}

/** Stats-aware local coach — used when free cloud is unavailable. */
export function localCoachReply(
  messages: CoachMessage[],
  profileSummary: string,
): string {
  const q =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const ql = q.toLowerCase();
  const hasGames =
    profileSummary &&
    profileSummary !== "No games imported yet." &&
    !/Games: 0\b/.test(profileSummary);

  const openingsWhite = /White openings:\s*(.+)/i.exec(profileSummary)?.[1];
  const openingsBlack = /Black openings:\s*(.+)/i.exec(profileSummary)?.[1];
  const record = /Games:\s*(.+)/i.exec(profileSummary)?.[1];
  const timeControls = /Time controls:\s*(.+)/i.exec(profileSummary)?.[1];

  if (/weak|mistake|blunder|lose|loss|improve|biggest/i.test(ql)) {
    return (
      (hasGames
        ? `Looking at your record (${record ?? "imported games"}), prioritize reviewing lost games from your most-played openings first — especially lines where your win rate dips.\n\n`
        : `Import your Lichess/Chess.com games so tips can target your real patterns.\n\n`) +
      `This week: 20 minutes of tactics daily, then replay 3 recent losses without an engine and write one “why I lost” note for each.`
    );
  }

  if (/opening/i.test(ql)) {
    return (
      (openingsWhite || openingsBlack
        ? `From your games — White: ${openingsWhite ?? "limited data"}; Black: ${openingsBlack ?? "limited data"}.\n\n`
        : `No opening data yet — import games first.\n\n`) +
      `Pick one main White system and one Black defense, learn the first 8–10 moves plus the typical middlegame plan, and stop hopping openings every session.`
    );
  }

  if (/uscf|rapid|tournament|event|section/i.test(ql)) {
    return (
      `For a USCF rapid/tournament day: warm up with 10 easy tactics, play one short practice game in the same time control, and review your opening notes — don’t grind a new repertoire the night before.\n\n` +
      (timeControls
        ? `Your online mix (${timeControls}) suggests practicing the event’s time control specifically so the clock feel matches.`
        : `Match your practice time control to the event (G/15–G/30 for rapid).`)
    );
  }

  if (/plan|7.?day|week|schedule|training/i.test(ql)) {
    return (
      `7-day plan: Day 1–2 openings (your main White/Black), Day 3–4 tactics (mixed motifs), Day 5 play 2 practice games in event time control, Day 6 review those games for one recurring mistake, Day 7 light tactics + rest.\n\n` +
      (hasGames
        ? `Anchor study to your real openings (${openingsWhite ?? "White"} / ${openingsBlack ?? "Black"}) instead of random YouTube lines.`
        : `Import games so days 1–2 target openings you actually play.`)
    );
  }

  return (
    (hasGames
      ? `Based on your stats (${record}): keep playing your main openings, fix one recurring endgame/tactical theme from recent losses, and add a short daily tactics block.\n\n`
      : `Import games for personalized advice. Meanwhile: one opening as White, one defense as Black, and 15 minutes of tactics daily.\n\n`) +
    `Ask about openings, weaknesses, USCF prep, or a weekly plan for a more targeted answer.`
  );
}

async function freeCoachReply(
  messages: CoachMessage[],
  profileSummary: string,
): Promise<string> {
  const chat = buildChatMessages(messages, profileSummary);
  const prompt = buildGetPrompt(messages, profileSummary);
  const started = Date.now();

  type Attempt = () => Promise<string>;
  const attempts: Attempt[] = [];

  for (const model of FREE_MODELS) {
    attempts.push(() => getPollText(model, prompt));
    attempts.push(() => postOpenAi(POLL_CHAT, model, chat));
    attempts.push(() =>
      postOpenAi(KEYLESS_CHAT, model, chat, {
        Authorization: "Bearer scoutnscore-free",
      }),
    );
  }

  return enqueue(async () => {
    for (const attempt of attempts) {
      if (Date.now() - started > OVERALL_MS - 400) break;
      try {
        return await attempt();
      } catch (e) {
        if (/429|busy/i.test(String(e))) await sleep(700);
      }
    }
    return localCoachReply(messages, profileSummary);
  });
}

export async function webCoachChat(
  messages: CoachMessage[],
  profileSummary: string,
): Promise<string> {
  return freeCoachReply(messages, profileSummary);
}

export async function* webCoachStream(
  messages: CoachMessage[],
  profileSummary: string,
): AsyncGenerator<string, void, unknown> {
  yield await freeCoachReply(messages, profileSummary);
}

export async function warmupWebCoach(): Promise<void> {
  // no-op — warmup burns the single free concurrent slot
}

export function setWebCoachProgress(
  _cb: ((message: string, percent: number | null) => void) | null,
) {
  // no-op
}
