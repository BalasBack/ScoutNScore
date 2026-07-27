import { Chess, DEFAULT_POSITION } from "chess.js";

export const START_FEN = DEFAULT_POSITION;

export type ParsedPgn = {
  moves: string[];
  fens: string[];
};

/** Strip clock/eval comments so chess.js can parse lichess/chess.com PGNs */
export function cleanPgn(pgn: string): string {
  const headers: string[] = [];
  const movetext: string[] = [];
  let inHeaders = true;

  for (const line of pgn.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      inHeaders = false;
      continue;
    }
    if (inHeaders && trimmed.startsWith("[")) {
      headers.push(trimmed);
    } else {
      inHeaders = false;
      const stripped = trimmed
        .replace(/\{[^}]*\}/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\(\$[0-9]+\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped) movetext.push(stripped);
    }
  }

  return [...headers, "", movetext.join(" ")].join("\n");
}

export function parsePgnGame(pgn: string): ParsedPgn {
  try {
    const chess = new Chess();
    chess.loadPgn(cleanPgn(pgn), { strict: false });
    const moves = chess.history();
    chess.reset();
    const fens = [chess.fen()];
    for (const move of moves) {
      chess.move(move);
      fens.push(chess.fen());
    }
    return { moves, fens };
  } catch {
    return { moves: [], fens: [START_FEN] };
  }
}

export function parsePgnMoves(pgn: string): string[] {
  return parsePgnGame(pgn).moves;
}

export type ParsedMoveDetail = {
  san: string;
  uci: string;
  fenBefore: string;
};

export function parsePgnMovesDetailed(pgn: string): ParsedMoveDetail[] {
  try {
    const chess = new Chess();
    chess.loadPgn(cleanPgn(pgn), { strict: false });
    const sans = chess.history();
    chess.reset();
    const out: ParsedMoveDetail[] = [];
    for (const san of sans) {
      const fenBefore = chess.fen();
      const m = chess.move(san);
      if (!m) break;
      const uci = m.from + m.to + (m.promotion ?? "");
      out.push({ san, uci, fenBefore });
    }
    return out;
  } catch {
    return [];
  }
}

export function fenAtMoveIndex(pgn: string, moveIndex: number): string {
  const { fens } = parsePgnGame(pgn);
  const idx = Math.max(0, Math.min(moveIndex, fens.length - 1));
  return fens[idx] ?? START_FEN;
}

export function classificationColor(c: string): string {
  switch (c) {
    case "best":
    case "excellent":
      return "text-emerald-400";
    case "good":
      return "text-green-400";
    case "inaccuracy":
      return "text-amber-400";
    case "mistake":
      return "text-orange-400";
    case "blunder":
      return "text-red-400";
    default:
      return "text-[var(--color-muted)]";
  }
}

export function isMateScore(cp: number): boolean {
  return Math.abs(cp) >= 5000;
}

export function formatEval(
  cp: number | null | undefined,
  fen?: string,
): string {
  if (fen) {
    try {
      const chess = new Chess(fen);
      if (chess.isCheckmate()) {
        return chess.turn() === "w" ? "Black wins" : "White wins";
      }
      if (chess.isStalemate()) return "Draw";
      if (chess.isDraw()) return "Draw";
    } catch {
      /* ignore invalid FEN */
    }
  }
  if (cp == null) return "—";
  if (isMateScore(cp)) {
    const plies = Math.max(1, Math.round((10000 - Math.abs(cp)) / 100));
    if (Math.abs(cp) >= 9900 && plies <= 1) {
      return cp > 0 ? "White wins" : "Black wins";
    }
    return cp > 0 ? `White mates in ${plies}` : `Black mates in ${plies}`;
  }
  const val = cp / 100;
  if (Math.abs(val) < 0.25) return "Equal";
  if (val > 0) return `White +${val.toFixed(1)}`;
  return `Black +${Math.abs(val).toFixed(1)}`;
}

/** 0–100: how much of the bar is white's share (50 = equal). */
export function evalBarWhitePercent(cp: number | null | undefined): number {
  if (cp == null) return 50;
  if (isMateScore(cp)) return cp > 0 ? 97 : 3;
  const pawn = cp / 100;
  const shifted = 50 + 50 * Math.tanh(pawn / 2.5);
  return Math.max(3, Math.min(97, shifted));
}

export function classificationLabel(c: string): string {
  switch (c) {
    case "best":
      return "Best move";
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "inaccuracy":
      return "Inaccuracy";
    case "mistake":
      return "Mistake";
    case "blunder":
      return "Blunder";
    case "opponent":
      return "Opponent move";
    default:
      return c;
  }
}

export function fenAfterUci(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    chess.move({ from, to, promotion });
    return chess.fen();
  } catch {
    return fen;
  }
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

/** Short human explanation of why the engine move is better than the blunder. */
export function explainBestMove(
  fen: string,
  bestUci: string,
  playedBlunderSan: string,
  cpLoss: number,
): string {
  try {
    const chess = new Chess(fen);
    const from = bestUci.slice(0, 2);
    const to = bestUci.slice(2, 4);
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    if (!move) {
      return `The best move was ${bestUci}. Your game continued with ${playedBlunderSan}, costing about ${(cpLoss / 100).toFixed(1)} pawns.`;
    }

    const parts: string[] = [];
    const san = move.san;
    parts.push(`Best was ${san}.`);

    if (move.flags.includes("k") || move.flags.includes("q")) {
      parts.push("Castling improves king safety and connects the rooks.");
    } else if (move.captured) {
      const cap =
        move.captured === "p"
          ? "pawn"
          : move.captured === "n"
            ? "knight"
            : move.captured === "b"
              ? "bishop"
              : move.captured === "r"
                ? "rook"
                : move.captured === "q"
                  ? "queen"
                  : "piece";
      parts.push(
        move.san.includes("x")
          ? `It wins (or reclaims) material by taking the ${cap} on ${move.to}.`
          : `It captures on ${move.to}.`,
      );
    } else if (move.san.includes("+") || move.san.includes("#")) {
      parts.push(
        move.san.includes("#")
          ? "It delivers checkmate."
          : "The check forces a reply and seizes the initiative.",
      );
    } else if (move.piece === "p" && (move.to[1] === "7" || move.to[1] === "2")) {
      parts.push("The advanced pawn creates promotion threats.");
    } else if (move.piece === "n" || move.piece === "b") {
      parts.push(
        `The ${move.piece === "n" ? "knight" : "bishop"} improves to a stronger square (${move.to}).`,
      );
    } else if (move.piece === "r" || move.piece === "q") {
      parts.push(
        `Activating the ${move.piece === "r" ? "rook" : "queen"} increases pressure.`,
      );
    } else if (move.piece === "k") {
      parts.push("The king move improves safety or prepares the next idea.");
    } else {
      parts.push(`It places the piece on a better square (${move.from}→${move.to}).`);
    }

    parts.push(
      `In the game you played ${playedBlunderSan}, giving up about ${(cpLoss / 100).toFixed(1)} pawns of evaluation.`,
    );
    return parts.join(" ");
  } catch {
    return `The engine preferred ${bestUci} over ${playedBlunderSan} (about ${(cpLoss / 100).toFixed(1)} pawns better).`;
  }
}

/** Turn Lichess opening URLs into readable names; pass through normal labels. */
export function isEcoCode(value: string): boolean {
  return /^[A-E]\d{2}(?:-\d+)?$/i.test(value.trim());
}

export function isMoveLine(value: string): boolean {
  return /^\d+\./.test(value.trim());
}

export function sanitizeOpeningLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "Unknown" ||
    trimmed === "???" ||
    isEcoCode(trimmed) ||
    isMoveLine(trimmed)
  ) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const slug = trimmed.split("/").filter(Boolean).pop() ?? "";
    if (!slug || slug === "opening") return null;
    return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

export function openingLabel(
  openingName: string | null | undefined,
  eco: string | null | undefined,
  pgn?: string,
): string {
  const fromName = sanitizeOpeningLabel(openingName);
  if (fromName) return fromName;

  if (pgn) {
    const headers = extractHeaders(pgn);
    const fromHeader = sanitizeOpeningLabel(headers.opening);
    if (fromHeader) return fromHeader;
  }

  const fromEco = ecoToName(eco);
  if (fromEco) return fromEco;
  if (eco && eco !== "???" && !isEcoCode(eco)) return eco;
  return "Unknown";
}

const ECO_NAMES: Record<string, string> = {
  A00: "Irregular Opening",
  A40: "Queen's Pawn Game",
  B01: "Scandinavian Defense",
  B06: "Modern Defense",
  B07: "Pirc Defense",
  B10: "Caro-Kann Defense",
  B20: "Sicilian Defense",
  B90: "Sicilian Defense, Najdorf Variation",
  C00: "French Defense",
  C30: "King's Gambit",
  C41: "Philidor Defense",
  C42: "Petrov Defense",
  C45: "Scotch Game",
  C50: "Italian Game",
  C55: "Two Knights Defense",
  C60: "Ruy Lopez",
  C65: "Ruy Lopez, Berlin Defense",
  D06: "Queen's Gambit",
  D10: "Queen's Gambit Declined",
  D20: "Queen's Gambit Accepted",
  E00: "Catalan Opening",
  E15: "Queen's Indian Defense",
  E20: "Nimzo-Indian Defense",
  E60: "King's Indian Defense",
};

function ecoToName(eco: string | null | undefined): string | null {
  if (!eco || eco === "???") return null;
  return ECO_NAMES[eco.toUpperCase()] ?? null;
}

export function openingDisplay(
  openingName: string | null | undefined,
  eco: string | null | undefined,
  pgn?: string,
): { name: string; eco: string | null } {
  const name = openingLabel(openingName, eco, pgn);
  const ecoCode =
    eco && eco !== "???" && isEcoCode(eco) ? eco.toUpperCase() : null;
  return { name, eco: ecoCode };
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
