import { openingDisplay } from "../chess";
import type {
  DossierOpeningStat,
  DossierRatingLine,
  DossierRecentGame,
  DossierRecord,
  OpponentCandidate,
  OpponentDossier,
} from "../types";
import { importOpponentChesscom, importOpponentLichess } from "./import";
import { importOpponentChessGames } from "./chessgames-client";
import * as db from "./db";
import { lookupUscfMember } from "./uscf-client";
import type { StoredGame } from "./db";

const MAX_ONLINE = 30;
const MAX_CHESSGAMES = 8;

function emptyRecord(): DossierRecord {
  return {
    wins: 0,
    draws: 0,
    losses: 0,
    as_white: { games: 0, wins: 0, draws: 0, losses: 0 },
    as_black: { games: 0, wins: 0, draws: 0, losses: 0 },
  };
}

function matchesOpponent(game: StoredGame, names: string[]): boolean {
  const w = game.white_player.toLowerCase();
  const b = game.black_player.toLowerCase();
  return names.some(
    (n) =>
      w === n ||
      b === n ||
      w.includes(n) ||
      b.includes(n) ||
      n.includes(w) ||
      n.includes(b),
  );
}

function opponentNames(candidate: OpponentCandidate): string[] {
  return [
    candidate.lichess_username,
    candidate.chesscom_username,
    candidate.name,
  ]
    .filter(Boolean)
    .map((n) => n!.toLowerCase().trim());
}

function buildFromGames(
  games: StoredGame[],
  candidate: OpponentCandidate,
): Pick<
  OpponentDossier,
  | "record"
  | "openings_as_white"
  | "openings_as_black"
  | "opening_lines"
  | "recent_games"
> {
  const record = emptyRecord();
  const whiteMap = new Map<
    string,
    { eco: string | null; games: number; wins: number; draws: number; losses: number }
  >();
  const blackMap = new Map<
    string,
    { eco: string | null; games: number; wins: number; draws: number; losses: number }
  >();
  const recent: DossierRecentGame[] = [];
  const names = opponentNames(candidate);

  for (const g of games) {
    const color =
      g.own_color ??
      (names.some((n) => g.white_player.toLowerCase() === n || g.white_player.toLowerCase().includes(n))
        ? "white"
        : "black");
    const result = g.result === "win" || g.result === "loss" || g.result === "draw"
      ? g.result
      : "draw";

    const bucket = color === "white" ? record.as_white : record.as_black;
    bucket.games++;
    if (result === "win") {
      bucket.wins++;
      record.wins++;
    } else if (result === "draw") {
      bucket.draws++;
      record.draws++;
    } else {
      bucket.losses++;
      record.losses++;
    }

    const { name: openingName } = openingDisplay(g.opening_name, g.eco, g.pgn);
    const map = color === "white" ? whiteMap : blackMap;
    const key = `${g.eco ?? "???"}|${openingName}`;
    const entry = map.get(key) ?? {
      eco: g.eco,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
    entry.games++;
    if (result === "win") entry.wins++;
    else if (result === "draw") entry.draws++;
    else entry.losses++;
    map.set(key, entry);

    if (recent.length < 12) {
      const foe =
        color === "white" ? g.black_player : g.white_player;
      recent.push({
        opponent: foe,
        result,
        opening: openingName,
        eco: g.eco,
        color,
        date: g.played_at,
        source: g.source,
        time_class: g.time_class,
      });
    }
  }

  const toOpeningStats = (
    map: Map<
      string,
      { eco: string | null; games: number; wins: number; draws: number; losses: number }
    >,
    color: string,
  ): DossierOpeningStat[] =>
    [...map.entries()]
      .map(([key, s]) => ({
        name: key.split("|").slice(1).join("|") || "Unknown",
        eco: s.eco,
        games: s.games,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        color,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 8);

  const openings_as_white = toOpeningStats(whiteMap, "white");
  const openings_as_black = toOpeningStats(blackMap, "black");
  const openingCounts = new Map<string, number>();
  for (const o of [...openings_as_white, ...openings_as_black]) {
    openingCounts.set(o.name, (openingCounts.get(o.name) ?? 0) + o.games);
  }
  const opening_lines = [...openingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n]) => n);

  return {
    record,
    openings_as_white,
    openings_as_black,
    opening_lines,
    recent_games: recent,
  };
}

async function fetchRatings(
  candidate: OpponentCandidate,
): Promise<DossierRatingLine[]> {
  const lines: DossierRatingLine[] = [];

  if (candidate.uscf_id) {
    try {
      const member = await lookupUscfMember(candidate.uscf_id);
      for (const r of member.ratings) {
        if (r.rating != null) {
          lines.push({
            label: r.rating_system
              .replace("OverTheBoard", "OTB ")
              .replace("Online", "Online "),
            rating: r.rating,
            source: "USCF",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (candidate.chesscom_username) {
    try {
      const res = await fetch(
        `https://api.chess.com/pub/player/${encodeURIComponent(candidate.chesscom_username)}/stats`,
      );
      if (res.ok) {
        const stats = (await res.json()) as Record<
          string,
          { last?: { rating?: number } } | undefined
        >;
        for (const [key, label] of [
          ["chess_rapid", "Rapid"],
          ["chess_blitz", "Blitz"],
          ["chess_bullet", "Bullet"],
          ["chess_daily", "Daily"],
        ] as const) {
          const rating = stats[key]?.last?.rating;
          if (rating != null) {
            lines.push({ label, rating, source: "Chess.com" });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (candidate.lichess_username) {
    try {
      const res = await fetch(
        `https://lichess.org/api/user/${encodeURIComponent(candidate.lichess_username)}`,
      );
      if (res.ok) {
        const user = (await res.json()) as {
          perfs?: Record<string, { games?: number; rating?: number }>;
        };
        for (const [key, label] of [
          ["rapid", "Rapid"],
          ["blitz", "Blitz"],
          ["classical", "Classical"],
          ["bullet", "Bullet"],
        ] as const) {
          const p = user.perfs?.[key];
          if (p && (p.games ?? 0) > 0 && p.rating != null) {
            lines.push({ label, rating: p.rating, source: "Lichess" });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!lines.length && candidate.rating != null) {
    lines.push({
      label: candidate.source === "fide" ? "FIDE Standard" : "Rating",
      rating: candidate.rating,
      source: candidate.source.toUpperCase(),
    });
  }

  return lines;
}

function buildStyleSummary(
  candidate: OpponentCandidate,
  record: DossierRecord,
  white: DossierOpeningStat[],
  black: DossierOpeningStat[],
  ratings: DossierRatingLine[],
): string {
  const parts: string[] = [];
  if (ratings[0]) {
    parts.push(`${ratings[0].source} ${ratings[0].label}: ${ratings[0].rating}`);
  } else if (candidate.rating != null) {
    parts.push(`Rating ~${candidate.rating}`);
  }

  const total = record.wins + record.draws + record.losses;
  if (total > 0) {
    const winPct = Math.round((record.wins / total) * 100);
    parts.push(
      `Recent sample: ${record.wins}W-${record.draws}D-${record.losses}L (${winPct}% wins over ${total} games)`,
    );
    if (record.as_white.games > record.as_black.games + 2) {
      parts.push("Prefers White");
    } else if (record.as_black.games > record.as_white.games + 2) {
      parts.push("Prefers Black");
    }
  }
  if (white[0]) parts.push(`As White: ${white[0].name} (${white[0].games} games)`);
  if (black[0]) parts.push(`As Black: ${black[0].name} (${black[0].games} games)`);

  if (!parts.length) {
    if (candidate.chesscom_username) parts.push(`Chess.com: @${candidate.chesscom_username}`);
    if (candidate.lichess_username) parts.push(`Lichess: @${candidate.lichess_username}`);
    if (candidate.uscf_id) parts.push(`USCF #${candidate.uscf_id}`);
    if (candidate.fide_id) parts.push(`FIDE #${candidate.fide_id}`);
    if (candidate.chessgames_id) parts.push(`ChessGames pid ${candidate.chessgames_id}`);
  }

  return parts.length
    ? parts.join(" · ")
    : "Profile linked — limited game data available. Try Online or ChessGames search for deeper prep.";
}

function buildTacticalNotes(
  record: DossierRecord,
  white: DossierOpeningStat[],
  black: DossierOpeningStat[],
): string {
  const total = record.wins + record.draws + record.losses;
  if (total === 0) {
    return "No recent games imported — tactical patterns unknown. Default to sound, principled play.";
  }
  const notes: string[] = [];
  const lossRate = record.losses / total;
  if (lossRate > 0.55) {
    notes.push(
      "Loses frequently in recent games — look for early pressure and tactical chances.",
    );
  } else if (record.wins / total > 0.55) {
    notes.push(
      "Strong recent form — play solidly and avoid unnecessary complications.",
    );
  }
  if (record.as_white.games > 0 && record.as_white.losses > record.as_white.wins) {
    notes.push(
      "Struggles as White in sample — consider fighting for the initiative with Black.",
    );
  }
  if (record.as_black.games > 0 && record.as_black.losses > record.as_black.wins) {
    notes.push(
      "Weaker as Black — prioritize a reliable defense and counterattacking chances.",
    );
  }
  for (const op of [...white, ...black].slice(0, 3)) {
    if (op.games >= 3 && op.losses > op.wins) {
      notes.push(
        `Scores poorly in ${op.name} as ${op.color} (${op.losses}L vs ${op.wins}W) — target this system.`,
      );
    }
  }
  return notes.length
    ? notes.join(" ")
    : "Balanced recent results — focus on your best repertoire and standard time management.";
}

function buildRecommendedPrep(
  candidate: OpponentCandidate,
  openings: string[],
  ratings: DossierRatingLine[],
): string {
  const rating = ratings[0]?.rating ?? candidate.rating ?? null;
  const steps: string[] = [];
  if (openings.length) {
    steps.push(`1. Study their main lines: ${openings.join(", ")}.`);
    steps.push(
      "2. Use Analysis → Scouted games to review imported games — note recurring plans and mistakes.",
    );
  } else {
    steps.push(
      "1. Search Online (Lichess/Chess.com) or ChessGames for this player to import games for opening-specific prep.",
    );
  }
  if (rating != null && rating < 1400) {
    steps.push(
      "3. Play principled development — avoid traps and focus on hanging-piece tactics.",
    );
  } else if (rating != null && rating < 1800) {
    steps.push(
      "3. Prepare one sharp and one solid option; punish slow development.",
    );
  } else {
    steps.push(
      "3. Prioritize accurate opening prep and endgame technique; avoid speculative sacrifices.",
    );
  }
  return steps.join(" ");
}

export async function buildOpponentDossier(
  candidate: OpponentCandidate,
): Promise<OpponentDossier> {
  let gamesChesscom = 0;
  let gamesLichess = 0;
  let gamesChessgames = 0;

  if (candidate.lichess_username) {
    const r = await importOpponentLichess(candidate.lichess_username, MAX_ONLINE);
    gamesLichess = r.imported;
  }
  if (candidate.chesscom_username) {
    const r = await importOpponentChesscom(candidate.chesscom_username, MAX_ONLINE);
    gamesChesscom = r.imported;
  }
  if (candidate.chessgames_id) {
    try {
      gamesChessgames = await importOpponentChessGames(
        candidate.chessgames_id,
        candidate.name,
        MAX_CHESSGAMES,
      );
    } catch {
      gamesChessgames = 0;
    }
  }

  const names = opponentNames(candidate);
  const all = await db.allStoredGames();
  const scoutGames = all
    .filter((g) => !g.is_own_game && matchesOpponent(g, names))
    .sort((a, b) => {
      const da = a.played_at ?? "";
      const db_ = b.played_at ?? "";
      return db_.localeCompare(da);
    })
    .slice(0, 40);

  const built = buildFromGames(scoutGames, candidate);
  const ratings = await fetchRatings(candidate);
  const bySource = (src: string) =>
    scoutGames.filter((g) => g.source === src).length;

  return {
    candidate,
    games_imported: Math.max(
      scoutGames.length,
      gamesChesscom + gamesLichess + gamesChessgames,
    ),
    games_imported_chesscom: bySource("chesscom") || gamesChesscom,
    games_imported_lichess: bySource("lichess") || gamesLichess,
    games_imported_chessgames: bySource("chessgames") || gamesChessgames,
    opening_lines: built.opening_lines,
    openings_as_white: built.openings_as_white,
    openings_as_black: built.openings_as_black,
    record: built.record,
    recent_games: built.recent_games,
    ratings,
    style_summary: buildStyleSummary(
      candidate,
      built.record,
      built.openings_as_white,
      built.openings_as_black,
      ratings,
    ),
    tactical_notes: buildTacticalNotes(
      built.record,
      built.openings_as_white,
      built.openings_as_black,
    ),
    recommended_prep: buildRecommendedPrep(
      candidate,
      built.opening_lines,
      ratings,
    ),
    ai_insight: null,
  };
}
