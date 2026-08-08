import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Dumbbell, Puzzle, RefreshCw, XCircle } from "lucide-react";
import { api, BlunderPuzzle } from "../lib/tauri";
import { Button, Card } from "../components/ui";
import { ChessBoardView, SquareClickArgs } from "../components/ChessBoard";
import {
  fenAfterUci,
  explainBestMove,
  sanitizeOpeningLabel,
  uciToSan,
} from "../lib/chess";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function Training() {
  const [queue, setQueue] = useState<BlunderPuzzle[]>([]);
  const [puzzle, setPuzzle] = useState<BlunderPuzzle | null>(null);
  const [fen, setFen] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [solved, setSolved] = useState<boolean | null>(null);
  const [attemptStart, setAttemptStart] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [solvedCount, setSolvedCount] = useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  const startPuzzle = useCallback((p: BlunderPuzzle) => {
    setPuzzle(p);
    setFen(p.fen);
    setFeedback(null);
    setExplanation(null);
    setSolved(null);
    setSelectedSquare(null);
    setAttemptStart(Date.now());
  }, []);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const p = await api.getBlunderPuzzles(40);
      const shuffled = shuffle(p);
      setQueue(shuffled);
      setSolvedCount(0);
      if (shuffled.length > 0) {
        startPuzzle(shuffled[0]);
      } else {
        setPuzzle(null);
        setFen("");
        setMessage(
          "No new puzzles — analyze more games or refresh after you've practiced the current set.",
        );
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const advance = () => {
    const rest = queue.filter((p) => p.id !== puzzle?.id);
    setQueue(rest);
    if (rest.length > 0) {
      startPuzzle(rest[0]);
    } else {
      setPuzzle(null);
      setFen("");
      setFeedback(null);
      setSolved(null);
      setSelectedSquare(null);
      setMessage("Set complete! Loading a fresh batch…");
      load();
    }
  };

  const attemptMove = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (!puzzle || solved !== null) return false;

      const played = `${sourceSquare}${targetSquare}`;
      const promotion =
        puzzle.best_move_uci.length > 4 ? puzzle.best_move_uci[4] : "";
      const playedFull = promotion ? `${played}${promotion}` : played;

      const isCorrect =
        playedFull === puzzle.best_move_uci ||
        played === puzzle.best_move_uci.slice(0, 4);

      const timeSecs = Math.round((Date.now() - attemptStart) / 1000);
      api.submitPuzzleAttempt(puzzle.id, isCorrect, timeSecs).catch(console.error);

      setSelectedSquare(null);

      if (isCorrect) {
        setSolved(true);
        const bestSan = uciToSan(puzzle.fen, puzzle.best_move_uci);
        setFeedback(`Correct! ${bestSan ?? puzzle.best_move_uci}`);
        setExplanation(
          explainBestMove(
            puzzle.fen,
            puzzle.best_move_uci,
            puzzle.played_move,
            puzzle.cp_loss,
          ),
        );
        setFen(fenAfterUci(puzzle.fen, puzzle.best_move_uci));
        setSolvedCount((c) => c + 1);
      } else {
        setSolved(false);
        setExplanation(null);
        setFeedback(
          `Not quite — you played ${puzzle.played_move}. Try again or reveal the solution.`,
        );
      }
      return isCorrect;
    },
    [attemptStart, puzzle, solved],
  );

  const onPieceDrop = ({
    sourceSquare,
    targetSquare,
  }: {
    piece: { position: string; pieceType: string; isSparePiece: boolean };
    sourceSquare: string;
    targetSquare: string | null;
  }) => {
    if (!targetSquare) return false;
    return attemptMove(sourceSquare, targetSquare);
  };

  const turnColor = fen.split(" ")[1] === "b" ? "b" : "w";

  const onSquareClick = ({ square, piece }: SquareClickArgs) => {
    if (!puzzle || solved !== null) return;

    const isOwnPiece =
      !!piece && piece.pieceType.toLowerCase().startsWith(turnColor);

    if (selectedSquare) {
      if (selectedSquare === square) {
        setSelectedSquare(null);
        return;
      }
      // Tap another of your pieces: switch selection instead of attempting a move
      if (isOwnPiece) {
        setSelectedSquare(square);
        return;
      }
      attemptMove(selectedSquare, square);
      return;
    }

    if (isOwnPiece) setSelectedSquare(square);
  };

  const squareStyles = useMemo(() => {
    if (!selectedSquare) return undefined;
    return {
      [selectedSquare]: {
        backgroundColor: "rgba(250, 204, 21, 0.55)",
      },
    };
  }, [selectedSquare]);

  const revealSolution = () => {
    if (!puzzle) return;
    const bestSan = uciToSan(puzzle.fen, puzzle.best_move_uci);
    setSolved(false);
    setSelectedSquare(null);
    setFeedback(`Solution: ${bestSan ?? puzzle.best_move_uci}`);
    setExplanation(
      explainBestMove(
        puzzle.fen,
        puzzle.best_move_uci,
        puzzle.played_move,
        puzzle.cp_loss,
      ),
    );
    setFen(fenAfterUci(puzzle.fen, puzzle.best_move_uci));
  };

  const openingName = puzzle
    ? sanitizeOpeningLabel(puzzle.opening_name) ?? "Unknown"
    : "Unknown";

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="flex flex-col gap-3 border-b border-[var(--color-border)] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <h1 className="text-xl font-bold">Training</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Fix your mistakes — puzzles from your own blunders
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {queue.length > 0 && (
            <span className="text-sm text-[var(--color-muted)]">
              {solvedCount} solved · {queue.length} remaining
            </span>
          )}
          <Button variant="secondary" onClick={load} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            New set
          </Button>
        </div>
      </header>

      <div className="space-y-6 p-4 sm:p-8">
        {message && !puzzle && (
          <Card>
            <div className="flex items-center gap-4 py-4">
              <Dumbbell className="h-10 w-10 text-[var(--color-accent)] opacity-60" />
              <p className="text-sm text-[var(--color-muted)]">{message}</p>
            </div>
          </Card>
        )}

        {puzzle && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Find the best move">
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                Tap a piece, then tap a square — or drag and drop.
              </p>
              <div className="mx-auto max-w-[420px]">
                <ChessBoardView
                  fen={fen}
                  allowDragging={solved === null}
                  showAnimations
                  squareStyles={squareStyles}
                  onPieceDrop={onPieceDrop}
                  onSquareClick={onSquareClick}
                />
              </div>
              {feedback && (
                <div
                  className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
                    solved
                      ? "bg-emerald-500/10 text-emerald-300"
                      : solved === false
                        ? "bg-red-500/10 text-red-300"
                        : ""
                  }`}
                >
                  {solved ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : solved === false ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : null}
                  <div className="min-w-0 space-y-1">
                    <div>{feedback}</div>
                    {explanation && (
                      <p className="leading-relaxed text-[var(--color-muted)]">
                        {explanation}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {solved === false && !explanation && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFen(puzzle.fen);
                        setFeedback(null);
                        setExplanation(null);
                        setSolved(null);
                        setSelectedSquare(null);
                        setAttemptStart(Date.now());
                      }}
                    >
                      Try again
                    </Button>
                    <Button variant="secondary" onClick={revealSolution}>
                      Show solution
                    </Button>
                  </>
                )}
                {(solved === true || explanation) && (
                  <Button onClick={advance}>
                    {queue.length > 1 ? "Next puzzle" : "Finish set"}
                  </Button>
                )}
              </div>
            </Card>

            <Card title="Puzzle info">
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-[var(--color-muted)]">Game: </span>
                  {puzzle.white_player} vs {puzzle.black_player}
                </p>
                <p>
                  <span className="text-[var(--color-muted)]">Opening: </span>
                  {openingName}
                </p>
                <p>
                  <span className="text-[var(--color-muted)]">Your blunder: </span>
                  <span className="text-red-400">{puzzle.played_move}</span>
                  <span className="text-[var(--color-muted)]">
                    {" "}
                    (missed ~{(puzzle.cp_loss / 100).toFixed(1)} pawns)
                  </span>
                </p>
                <p className="text-[var(--color-muted)]">
                  Tap a piece then a square (or drag). Solved puzzles won&apos;t
                  repeat until you start a new set.
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <Puzzle className="h-5 w-5 text-[var(--color-accent)]" />
                  <span className="text-xs text-[var(--color-muted)]">
                    Positions from your Stockfish-analyzed games
                  </span>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
