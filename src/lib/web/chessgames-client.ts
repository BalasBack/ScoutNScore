import type { OpponentCandidate } from "../types";
import { fetchTextCors } from "./cors-fetch";
import { openingLabel } from "../chess";
import { normalizePersonQuery, sortByNameMatch } from "./name-match";
import * as db from "./db";

export type ChessGamesGame = {
  game_id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  date: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractPlayerName(html: string, pid: string): string | null {
  const re = new RegExp(
    `chessplayer\\?pid=${pid}[^>]*>([^<]+)<`,
    "i",
  );
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}

function extractTag(pgn: string, tag: string): string | null {
  const re = new RegExp(`\\[${tag}\\s+"([^"]+)"\\]`, "i");
  return pgn.match(re)?.[1] ?? null;
}

function extractPgn(html: string): string | null {
  const start = html.indexOf("[Event ");
  if (start < 0) return null;
  const rest = html.slice(start);
  const end = rest.indexOf("</pre>");
  return (end >= 0 ? rest.slice(0, end) : rest).trim() || null;
}

/**
 * ChessGames.com player search.
 * Correct endpoint is player=…&playercomp=either (not ?search=).
 */
export async function searchChessGamesPlayers(
  query: string,
  limit = 8,
): Promise<OpponentCandidate[]> {
  const q = normalizePersonQuery(query);
  if (!q) return [];

  await sleep(400);
  const url =
    `https://www.chessgames.com/perl/chess.pl?player=${encodeURIComponent(q)}` +
    `&playercomp=either`;
  const html = await fetchTextCors(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ScoutNScore/1.0",
    },
  });

  if (/returned the following player listings:\s*\(0 players\)/i.test(html)) {
    return [];
  }

  const results: OpponentCandidate[] = [];
  const seen = new Set<string>();

  // Prefer named links: chessplayer?pid=52948">Magnus Carlsen
  const namedRe = /chessplayer\?pid=(\d+)[^>]*>([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(html)) !== null) {
    const pid = m[1];
    const name = m[2].trim();
    if (!name || seen.has(pid)) continue;
    // Skip nav chrome / empty anchors
    if (name.length < 2 || /^[\d\s]+$/.test(name)) continue;
    seen.add(pid);
    results.push({
      id: `cg_${pid}`,
      name,
      source: "chessgames",
      rating: null,
      federation: null,
      fide_id: null,
      uscf_id: null,
      chessgames_id: pid,
      chesscom_username: null,
      lichess_username: null,
    });
  }

  // Fallback: any pid links with nearby name extraction
  if (!results.length) {
    const linkRe = /chessplayer\?pid=(\d+)/gi;
    while ((m = linkRe.exec(html)) !== null && results.length < limit * 2) {
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);
      const name = extractPlayerName(html, pid);
      if (!name) continue;
      results.push({
        id: `cg_${pid}`,
        name,
        source: "chessgames",
        rating: null,
        federation: null,
        fide_id: null,
        uscf_id: null,
        chessgames_id: pid,
        chesscom_username: null,
        lichess_username: null,
      });
    }
  }

  return sortByNameMatch(q, results, (c) => c.name, 20).slice(0, limit);
}

async function fetchGamePgn(gameId: string): Promise<ChessGamesGame | null> {
  const url = `https://www.chessgames.com/perl/chessgame?gid=${gameId}`;
  const html = await fetchTextCors(url);
  const pgn = extractPgn(html);
  if (!pgn) return null;
  return {
    game_id: gameId,
    pgn,
    white: extractTag(pgn, "White") ?? "Unknown",
    black: extractTag(pgn, "Black") ?? "Unknown",
    result: extractTag(pgn, "Result") ?? "*",
    date: extractTag(pgn, "Date"),
  };
}

export async function fetchChessGamesRecent(
  playerId: string,
  max = 8,
): Promise<ChessGamesGame[]> {
  await sleep(400);
  const url = `https://www.chessgames.com/perl/chessplayer?pid=${playerId}`;
  const html = await fetchTextCors(url);

  const gameIds: string[] = [];
  const seen = new Set<string>();
  const linkRe = /chessgame\?gid=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && gameIds.length < max) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    gameIds.push(m[1]);
  }

  const games: ChessGamesGame[] = [];
  for (const gid of gameIds) {
    await sleep(500);
    try {
      const g = await fetchGamePgn(gid);
      if (g) games.push(g);
    } catch {
      /* skip failed game */
    }
  }
  return games;
}

/** Import ChessGames PGNs as scout (non-own) games. Returns newly inserted count. */
export async function importOpponentChessGames(
  playerId: string,
  opponentName: string,
  max = 8,
): Promise<number> {
  const games = await fetchChessGamesRecent(playerId, max);
  let imported = 0;
  const nameLower = opponentName.toLowerCase();

  for (const g of games) {
    const whiteLower = g.white.toLowerCase();
    const blackLower = g.black.toLowerCase();
    const isWhite =
      whiteLower.includes(nameLower) ||
      g.white.toLowerCase() === nameLower;
    const color = isWhite || !blackLower.includes(nameLower) ? "white" : "black";

    const eco = extractTag(g.pgn, "ECO");
    const openingName = openingLabel(
      extractTag(g.pgn, "Opening"),
      eco,
      g.pgn,
    );

    const resultForOpp =
      g.result === "1-0"
        ? color === "white"
          ? "win"
          : "loss"
        : g.result === "0-1"
          ? color === "black"
            ? "win"
            : "loss"
          : "draw";

    const inserted = await db.upsertGame({
      source: "chessgames",
      external_id: `cg_${g.game_id}`,
      pgn: g.pgn,
      white_player: g.white,
      black_player: g.black,
      white_elo: null,
      black_elo: null,
      result: resultForOpp,
      eco,
      opening_name: openingName === "Unknown" ? null : openingName,
      time_class: "classical",
      played_at: g.date,
      is_own_game: false,
      own_color: color,
      analyzed_at: null,
      avg_cp_loss: null,
      position_evals_json: null,
    });
    if (inserted) imported++;
  }
  return imported;
}
