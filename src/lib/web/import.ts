import { openingLabel } from "../chess";
import type { ImportResult } from "../types";
import * as db from "./db";

export type ImportOptions = {
  /** false = opponent/scout games (excluded from your dashboard stats) */
  isOwnGame: boolean;
};

const OWN: ImportOptions = { isOwnGame: true };
const OPPONENT: ImportOptions = { isOwnGame: false };

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "");
}

function extractHeaders(pgn: string): { eco?: string; opening?: string } {
  const result: { eco?: string; opening?: string } = {};
  for (const line of pgn.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("[")) break;
    const eco = t.match(/\[ECO\s+"([^"]+)"\]/i);
    const opening = t.match(/\[Opening\s+"([^"]+)"\]/i);
    if (eco) result.eco = eco[1];
    if (opening) result.opening = opening[1];
  }
  return result;
}

function normalizeChesscomResult(
  whiteResult: string,
  blackResult: string,
  username: string,
  whiteUser: string,
): { result: string; isWhite: boolean; ownColor: string } {
  const isWhite = whiteUser.toLowerCase() === username.toLowerCase();
  const ownResult = isWhite ? whiteResult : blackResult;
  const result =
    ownResult === "win"
      ? "win"
      : ["checkmated", "timeout", "resigned", "lose", "abandoned"].includes(
            ownResult,
          )
        ? "loss"
        : "draw";
  return { result, isWhite, ownColor: isWhite ? "white" : "black" };
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = 3,
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, init);
    last = res;
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
  }
  return last!;
}

export async function importLichess(
  username: string,
  maxGames: number,
  options: ImportOptions = OWN,
): Promise<ImportResult> {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Lichess username is empty");
  }
  // pgnInJson=true is required — without it NDJSON games have no `pgn` field
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}` +
    `?max=${maxGames}&pgnInJson=true&opening=true&clocks=false` +
    `&perfType=bullet,blitz,rapid,classical&rated=true`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/x-ndjson" },
  });
  if (!res.ok) {
    throw new Error(`Lichess import failed: ${res.status}`);
  }
  const text = await res.text();
  if (!text.trim()) {
    return {
      imported: 0,
      skipped: 0,
      source: "lichess",
      message: `No rated blitz/rapid/classical/bullet games found on Lichess for ${user}`,
    };
  }
  let imported = 0;
  let skipped = 0;
  let processed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (processed >= maxGames) break;
    const game = JSON.parse(line) as {
      id: string;
      pgn?: string;
      players: {
        white: { user?: { name: string }; rating?: number };
        black: { user?: { name: string }; rating?: number };
      };
      winner?: string;
      opening?: { eco?: string; name?: string };
      speed?: string;
      createdAt?: number;
    };
    const pgn = game.pgn;
    if (!pgn) continue;
    processed++;
    const whiteName = game.players.white.user?.name ?? "Anonymous";
    const blackName = game.players.black.user?.name ?? "Anonymous";
    const isWhite = whiteName.toLowerCase() === user.toLowerCase();
    const isBlack = blackName.toLowerCase() === user.toLowerCase();
    if (!isWhite && !isBlack) continue;
    const headers = extractHeaders(pgn);
    const eco = game.opening?.eco ?? headers.eco ?? null;
    const openingName =
      game.opening?.name ??
      headers.opening ??
      openingLabel(null, eco ?? null, pgn);
    const result =
      game.winner === "white"
        ? isWhite
          ? "win"
          : "loss"
        : game.winner === "black"
          ? isBlack
            ? "win"
            : "loss"
          : "draw";
    const playedAt = game.createdAt
      ? new Date(game.createdAt).toISOString()
      : null;
    const inserted = await db.upsertGame({
      source: "lichess",
      external_id: game.id,
      pgn,
      white_player: whiteName,
      black_player: blackName,
      white_elo: game.players.white.rating ?? null,
      black_elo: game.players.black.rating ?? null,
      result,
      eco,
      opening_name: openingName === "Unknown" ? null : openingName,
      time_class: game.speed ?? null,
      played_at: playedAt,
      is_own_game: options.isOwnGame,
      own_color: isWhite ? "white" : "black",
      analyzed_at: null,
      avg_cp_loss: null,
      position_evals_json: null,
    });
    if (inserted) imported++;
    else skipped++;
  }
  return {
    imported,
    skipped,
    source: "lichess",
    message:
      imported > 0
        ? `Imported ${imported} ${options.isOwnGame ? "of your" : "opponent"} games from Lichess (${user})${skipped ? ` · ${skipped} already saved` : ""}`
        : skipped > 0
          ? `All ${skipped} Lichess games for ${user} were already imported`
          : `No importable games found on Lichess for ${user}`,
  };
}

export async function importChesscom(
  username: string,
  maxGames: number,
  options: ImportOptions = OWN,
): Promise<ImportResult> {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Chess.com username is empty");
  }
  const archivesRes = await fetchWithRetry(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  if (!archivesRes.ok) {
    throw new Error(
      `Chess.com user not found or unavailable (${archivesRes.status})`,
    );
  }
  const archivesData = (await archivesRes.json()) as { archives: string[] };
  if (!archivesData.archives?.length) {
    return {
      imported: 0,
      skipped: 0,
      source: "chesscom",
      message: `No game archives found on Chess.com for ${user}`,
    };
  }
  let imported = 0;
  let skipped = 0;
  let processed = 0;
  const archives = [...archivesData.archives].reverse();
  for (const archiveUrl of archives) {
    if (processed >= maxGames) break;
    await new Promise((r) => setTimeout(r, 300));
    const monthRes = await fetchWithRetry(archiveUrl);
    if (!monthRes.ok) continue;
    const month = (await monthRes.json()) as {
      games: Array<{
        url: string;
        pgn?: string;
        time_class?: string;
        end_time?: number;
        eco?: string;
        white: { username: string; rating?: number; result: string };
        black: { username: string; rating?: number; result: string };
      }>;
    };
    const games = [...(month.games ?? [])].reverse();
    for (const game of games) {
      if (processed >= maxGames) break;
      // Skip daily/correspondence-only noise; keep bullet/blitz/rapid/classical
      if (game.time_class === "daily") continue;
      if (!game.pgn) continue;
      processed++;
      const { result, ownColor } = normalizeChesscomResult(
        game.white.result,
        game.black.result,
        user,
        game.white.username,
      );
      const headers = extractHeaders(game.pgn);
      const eco = game.eco ?? headers.eco ?? null;
      const openingName = openingLabel(headers.opening, eco, game.pgn);
      const externalId = game.url.split("/").pop() ?? game.url;
      const playedAt = game.end_time
        ? new Date(game.end_time * 1000).toISOString()
        : null;
      const inserted = await db.upsertGame({
        source: "chesscom",
        external_id: externalId,
        pgn: game.pgn,
        white_player: game.white.username,
        black_player: game.black.username,
        white_elo: game.white.rating ?? null,
        black_elo: game.black.rating ?? null,
        result,
        eco,
        opening_name: openingName === "Unknown" ? null : openingName,
        time_class: game.time_class ?? null,
        played_at: playedAt,
        is_own_game: options.isOwnGame,
        own_color: ownColor,
        analyzed_at: null,
        avg_cp_loss: null,
        position_evals_json: null,
      });
      if (inserted) imported++;
      else skipped++;
    }
  }
  return {
    imported,
    skipped,
    source: "chesscom",
    message:
      imported > 0
        ? `Imported ${imported} ${options.isOwnGame ? "of your" : "opponent"} games from Chess.com (${user})${skipped ? ` · ${skipped} already saved` : ""}`
        : skipped > 0
          ? `All ${skipped} Chess.com games for ${user} were already imported`
          : `No importable games found on Chess.com for ${user}`,
  };
}

export function importOpponentLichess(username: string, maxGames: number) {
  return importLichess(username, maxGames, OPPONENT);
}

export function importOpponentChesscom(username: string, maxGames: number) {
  return importChesscom(username, maxGames, OPPONENT);
}
