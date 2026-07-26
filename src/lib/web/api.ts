import { formatCoachProfile } from "../ollama-client";
import { checkWebCoach, webCoachChat } from "../web-llm-client";
import { analyzeGame } from "./analyze";
import * as db from "./db";
import { importChesscom, importLichess } from "./import";
import { checkStockfish } from "./stockfish-engine";
import {
  backfillOpenings,
  getAnalysisSummary,
  getBlunderPuzzles,
  getPlayerStats,
} from "./stats";
import {
  lookupUscfMember,
  memberToCandidate,
  searchUscfMembers,
} from "./uscf-client";
import { searchFidePlayers } from "./fide-client";
import { searchChessGamesPlayers } from "./chessgames-client";
import { buildOpponentDossier } from "./dossier";
import { sortByNameMatch } from "./name-match";
import type { ChessScopeApi, OpponentCandidate } from "../types";

async function searchLichess(query: string): Promise<OpponentCandidate[]> {
  const res = await fetch(
    `https://lichess.org/api/player/autocomplete?term=${encodeURIComponent(query)}&object=1&friend=0`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    result: Array<{ id: string; name: string; title?: string }>;
  };
  return data.result.slice(0, 10).map((u) => ({
    id: `lichess_${u.id}`,
    name: u.name || u.id,
    source: "lichess",
    rating: null,
    federation: u.title ?? null,
    fide_id: null,
    uscf_id: null,
    chessgames_id: null,
    chesscom_username: null,
    lichess_username: u.id,
  }));
}

async function searchChesscom(query: string): Promise<OpponentCandidate[]> {
  const variants = [
    query,
    query.toLowerCase(),
    query.replace(/\s+/g, ""),
  ];
  const seen = new Set<string>();
  const out: OpponentCandidate[] = [];
  for (const v of variants) {
    if (seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    try {
      const res = await fetch(
        `https://api.chess.com/pub/player/${encodeURIComponent(v)}`,
      );
      if (!res.ok) continue;
      const p = (await res.json()) as {
        username: string;
        name?: string;
        country?: string;
      };
      out.push({
        id: `chesscom_${p.username}`,
        name: p.name || p.username,
        source: "chesscom",
        rating: null,
        federation: p.country ?? null,
        fide_id: null,
        uscf_id: null,
        chessgames_id: null,
        chesscom_username: p.username,
        lichess_username: null,
      });
      if (out.length >= 5) break;
    } catch {
      /* skip */
    }
  }
  return out;
}

export const webApi: ChessScopeApi = {
  getSettings: db.getSettings,
  saveSettings: db.saveSettings,

  importChesscom: async (username, maxGames, asOpponent) => {
    const settings = await db.getSettings();
    const opts = asOpponent ? { isOwnGame: false } : { isOwnGame: true };
    return importChesscom(
      username,
      maxGames ?? settings.default_game_count ?? 100,
      opts,
    );
  },

  importLichess: async (username, maxGames, asOpponent) => {
    const settings = await db.getSettings();
    const opts = asOpponent ? { isOwnGame: false } : { isOwnGame: true };
    return importLichess(
      username,
      maxGames ?? settings.default_game_count ?? 100,
      opts,
    );
  },

  syncAll: async () => {
    const s = await db.getSettings();
    const results = [];
    const chesscom = s.chesscom_username?.trim().replace(/^@/, "") || null;
    const lichess = s.lichess_username?.trim().replace(/^@/, "") || null;
    if (chesscom) {
      results.push(await importChesscom(chesscom, s.default_game_count ?? 100));
    }
    if (lichess) {
      results.push(await importLichess(lichess, s.default_game_count ?? 100));
    }
    if (!results.length) {
      throw new Error("Add Chess.com or Lichess username in Settings first.");
    }
    return results;
  },

  listGames: (limit, offset, ownOnly) => db.listGames(limit, offset, ownOnly),
  getGameCount: db.getGameCount,
  getScoutedGameCount: db.getScoutedGameCount,
  getPlayerStats,
  backfillOpenings,

  lookupUscf: (uscfId) => lookupUscfMember(uscfId),

  checkOllama: async () => checkWebCoach(),

  coachChat: async (_model, messages) => {
    const stats = await getPlayerStats();
    return webCoachChat(messages, formatCoachProfile(stats));
  },

  checkStockfish,
  getGameAnalysis: db.getAnalysis,

  analyzeGame: async (gameId) => {
    const settings = await db.getSettings();
    return analyzeGame(gameId, settings.analysis_depth ?? 14);
  },

  analyzePendingGames: async (limit = 10) => {
    const games = await db.allStoredGames();
    const pending = games.filter((g) => g.is_own_game && !g.analyzed_at);
    let count = 0;
    for (const g of pending.slice(0, limit)) {
      await webApi.analyzeGame(g.id);
      count++;
    }
    return count;
  },

  getAnalysisSummary,
  getBlunderPuzzles,
  submitPuzzleAttempt: async (puzzleId, solved, _timeSecs) => {
    if (solved) await db.recordPuzzleAttempt(puzzleId, true);
  },

  searchOpponents: async (query, sources) => {
    const q = query.trim();
    if (!q) throw new Error("Enter a player name or username to search");

    const want = (src: string) =>
      !sources?.length ||
      sources.some((s) => s.toLowerCase() === src.toLowerCase());

    const results: OpponentCandidate[] = [];
    const errors: string[] = [];

    const run = async (
      label: string,
      enabled: boolean,
      fn: () => Promise<OpponentCandidate[]>,
    ) => {
      if (!enabled) return;
      try {
        results.push(...(await fn()));
      } catch (e) {
        errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    await run("USCF", want("uscf"), async () => {
      const members = await searchUscfMembers(q, 12);
      return members.map(memberToCandidate);
    });
    await run("FIDE", want("fide"), () => searchFidePlayers(q, 12));
    await run(
      "Lichess",
      want("lichess") || want("online"),
      () => searchLichess(q),
    );
    await run(
      "Chess.com",
      want("chesscom") || want("online"),
      () => searchChesscom(q),
    );
    await run("ChessGames", want("chessgames"), () =>
      searchChessGamesPlayers(q, 8),
    );

    if (!results.length) {
      const detail = errors.length ? ` (${errors.join("; ")})` : "";
      throw new Error(`No opponents found for "${q}"${detail}`);
    }
    return sortByNameMatch(q, results, (c) => c.name, 1);
  },

  buildOpponentDossier,

  repairScoutGames: () => db.repairScoutGames(),
};
