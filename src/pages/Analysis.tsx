import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Swords,
} from "lucide-react";
import { subscribeAnalysisProgress } from "../lib/analysis-progress";
import { api, GameAnalysis, GameRecord, MoveAnalysis } from "../lib/tauri";
import { ChessBoardView } from "../components/ChessBoard";
import { Button } from "../components/ui";
import {
  classificationColor,
  classificationLabel,
  evalBarWhitePercent,
  formatEval,
  openingDisplay,
  parsePgnGame,
  START_FEN,
} from "../lib/chess";
import { formatResult, resultColor, cn } from "../lib/utils";

/** Absolute position eval for the current board index (not relative to last move). */
function positionEvalAt(
  analysis: GameAnalysis | null,
  moveIndex: number,
): number | null | undefined {
  if (!analysis) return null;
  if (analysis.position_evals?.length > moveIndex) {
    return analysis.position_evals[moveIndex];
  }
  if (moveIndex === 0) return null;
  return analysis.moves[moveIndex - 1]?.eval_cp;
}

function EvalBar({
  cp,
  fen,
}: {
  cp: number | null | undefined;
  fen?: string;
}) {
  const whitePct = evalBarWhitePercent(cp);
  return (
    <div className="mb-2 sm:mb-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--color-muted)]">Position</span>
        <span className="font-semibold">{formatEval(cp, fen)}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full ring-1 ring-[var(--color-border)]">
        <div
          className="bg-zinc-100 transition-all duration-300"
          style={{ width: `${whitePct}%` }}
        />
        <div
          className="bg-zinc-700 transition-all duration-300"
          style={{ width: `${100 - whitePct}%` }}
        />
      </div>
    </div>
  );
}

function MoveBadge({ ma }: { ma: MoveAnalysis }) {
  if (!ma.is_own_move || ma.classification === "opponent") return null;
  const loss =
    ma.cp_loss > 0 ? ` (−${(ma.cp_loss / 100).toFixed(1)})` : "";
  return (
    <span className={`text-[10px] font-medium ${classificationColor(ma.classification)}`}>
      {classificationLabel(ma.classification)}
      {loss}
    </span>
  );
}

export function Analysis() {
  const [gameFilter, setGameFilter] = useState<"mine" | "scouted">("mine");
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selected, setSelected] = useState<GameRecord | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [moveIndex, setMoveIndex] = useState(0);
  const [fen, setFen] = useState(START_FEN);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pgnMoves, setPgnMoves] = useState<string[]>([]);
  const [positionFens, setPositionFens] = useState<string[]>([START_FEN]);

  const loadGames = useCallback(() => {
    api.listGames(100, 0, gameFilter === "mine").then(setGames).catch(console.error);
  }, [gameFilter]);

  useEffect(() => {
    loadGames();
    api.backfillOpenings().then(loadGames).catch(() => {});
  }, [loadGames]);

  useEffect(() => {
    return subscribeAnalysisProgress((payload) => {
      if (selected && payload.game_id === selected.id) {
        setProgress(payload.message);
      }
    });
  }, [selected]);

  useEffect(() => {
    if (!selected?.pgn) {
      setFen(START_FEN);
      setPgnMoves([]);
      setPositionFens([START_FEN]);
      setAnalysis(null);
      return;
    }
    const parsed = parsePgnGame(selected.pgn);
    setPgnMoves(parsed.moves);
    setPositionFens(parsed.fens);
    setMoveIndex(0);
    setFen(parsed.fens[0] ?? START_FEN);
    api.getGameAnalysis(selected.id).then(setAnalysis).catch(() => setAnalysis(null));
  }, [selected]);

  useEffect(() => {
    setFen(positionFens[moveIndex] ?? START_FEN);
  }, [moveIndex, positionFens]);

  const currentMoveAnalysis: MoveAnalysis | undefined =
    analysis?.moves[moveIndex > 0 ? moveIndex - 1 : 0];

  const positionEval = positionEvalAt(analysis, moveIndex);

  const opening = selected
    ? openingDisplay(selected.opening_name, selected.eco, selected.pgn)
    : null;

  const handleAnalyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    setProgress("Starting Stockfish...");
    try {
      const result = await api.analyzeGame(selected.id);
      setAnalysis(result);
      loadGames();
      setSelected((g) => (g ? { ...g, analyzed: true, avg_cp_loss: result.avg_cp_loss } : g));
    } catch (e) {
      setError(String(e));
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  };

  const movePairs: { num: number; white?: string; black?: string; wi: number; bi: number }[] =
    [];
  for (let i = 0; i < pgnMoves.length; i += 2) {
    movePairs.push({
      num: Math.floor(i / 2) + 1,
      white: pgnMoves[i],
      black: pgnMoves[i + 1],
      wi: i,
      bi: i + 1,
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-surface)]">
      <header className="flex shrink-0 flex-col gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-lg font-bold">Game Analysis</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Review games — your stats use &quot;My games&quot; only
          </p>
        </div>
        {selected && (
          <Button onClick={handleAnalyze} loading={analyzing} disabled={analyzing} className="w-full sm:w-auto">
            <Cpu className="h-4 w-4" />
            {selected.analyzed ? "Re-analyze" : "Analyze"}
          </Button>
        )}
      </header>

      {progress && (
        <div className="shrink-0 border-b border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-6 py-2 text-sm">
          {progress}
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Game list */}
        <aside
          className={cn(
            "shrink-0 overflow-auto border-[var(--color-border)] bg-[var(--color-surface-2)]/50",
            selected
              ? "max-h-44 border-b lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r"
              : "min-h-0 flex-1 border-b lg:w-72 lg:flex-none lg:border-b-0 lg:border-r",
          )}
        >
          <div className="flex border-b border-[var(--color-border)] p-2 gap-1">
            {(["mine", "scouted"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setGameFilter(f);
                  setSelected(null);
                }}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                  gameFilter === f
                    ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-3)]"
                }`}
              >
                {f === "mine" ? "My games" : "Scouted"}
              </button>
            ))}
          </div>
          {games.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-muted)]">
              {gameFilter === "mine"
                ? "No games yet. Link accounts in Settings and sync from Dashboard."
                : "No scouted games. Import opponents via Opponent Scout."}
            </p>
          ) : (
            games.map((g) => {
              const op = openingDisplay(g.opening_name, g.eco, g.pgn);
              return (
                <button
                  key={g.id}
                  onClick={() => setSelected(g)}
                  className={`w-full border-b border-[var(--color-border)]/60 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-3)] ${
                    selected?.id === g.id
                      ? "border-l-2 border-l-[var(--color-accent)] bg-[var(--color-surface-3)]"
                      : "border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {g.white_player} vs {g.black_player}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                        {op.name}
                        {op.eco && (
                          <span className="ml-1 font-mono text-[var(--color-accent)]">
                            {op.eco}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`text-xs font-medium ${resultColor(g.result)}`}>
                        {formatResult(g.result)}
                      </span>
                      {!g.is_own_game && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                          scout
                        </span>
                      )}
                      {g.analyzed && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                          analyzed
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {selected ? (
          <>
            {/* Board panel — eval, board, move #, and remark stay visible together */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-3 sm:px-6 sm:pt-4 lg:overflow-auto lg:p-6">
              <div className="flex min-h-0 w-full max-w-lg flex-1 flex-col self-center lg:flex-none">
                <div className="mb-2 flex shrink-0 items-start justify-between gap-3 sm:mb-3 sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Swords className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                      <span className="truncate">
                        {selected.white_player} vs {selected.black_player}
                      </span>
                    </div>
                    {opening && (
                      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)] sm:mt-1 sm:text-sm">
                        {opening.name}
                        {opening.eco && (
                          <span className="ml-2 font-mono text-xs text-[var(--color-accent)]">
                            {opening.eco}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 text-sm font-medium ${resultColor(selected.result)}`}>
                    {formatResult(selected.result)}
                  </span>
                </div>

                {analysis && positionEval != null && (
                  <div className="shrink-0">
                    <EvalBar cp={positionEval} fen={fen} />
                  </div>
                )}

                <div className="mx-auto flex min-h-0 w-full flex-1 items-center justify-center py-1 lg:flex-none lg:py-0">
                  <div className="aspect-square h-auto max-h-full w-full max-w-[min(100%,calc(100dvh-18rem))] lg:max-w-none">
                    <ChessBoardView fen={fen} />
                  </div>
                </div>

                <div className="mt-2 flex shrink-0 items-center justify-center gap-1 sm:mt-3">
                  <Button variant="ghost" onClick={() => setMoveIndex(0)} title="Start">
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setMoveIndex((i) => Math.max(0, i - 1))}
                    title="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[72px] text-center text-sm tabular-nums text-[var(--color-muted)]">
                    {moveIndex} / {pgnMoves.length}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setMoveIndex((i) => Math.min(pgnMoves.length, i + 1))
                    }
                    title="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setMoveIndex(pgnMoves.length)}
                    title="End"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>

                {currentMoveAnalysis && moveIndex > 0 && (
                  <div className="mt-2 shrink-0 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-center text-sm sm:mt-3 sm:px-4 sm:py-3">
                    <span className="font-mono font-semibold">
                      {currentMoveAnalysis.san}
                    </span>
                    {currentMoveAnalysis.is_own_move &&
                      currentMoveAnalysis.classification !== "opponent" && (
                        <span
                          className={`ml-2 ${classificationColor(currentMoveAnalysis.classification)}`}
                        >
                          — {classificationLabel(currentMoveAnalysis.classification)}
                        </span>
                      )}
                  </div>
                )}
              </div>
            </main>

            {/* Move list */}
            <aside className="max-h-[28vh] shrink-0 overflow-auto border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/30 p-3 lg:max-h-none lg:w-64 lg:border-l lg:border-t-0">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                Moves
              </div>
              {pgnMoves.length === 0 ? (
                <p className="text-xs text-[var(--color-muted)]">Could not parse PGN.</p>
              ) : (
                <div className="space-y-0.5">
                  <div className="mb-1 grid grid-cols-[1.5rem_1fr_1fr] gap-1 px-1 text-[10px] font-medium text-[var(--color-muted)]">
                    <span>#</span>
                    <span>White</span>
                    <span>Black</span>
                  </div>
                  {movePairs.map(({ num, white, black, wi, bi }) => (
                    <div
                      key={num}
                      className="grid grid-cols-[1.5rem_1fr_1fr] gap-1 text-xs"
                    >
                      <span className="py-1 pl-1 text-[var(--color-muted)]">{num}</span>
                      {white ? (
                        <button
                          onClick={() => setMoveIndex(wi + 1)}
                          className={`rounded px-1.5 py-1 text-left ${
                            moveIndex === wi + 1
                              ? "bg-[var(--color-accent)]/25 font-medium"
                              : "hover:bg-[var(--color-surface-3)]"
                          }`}
                        >
                          <div>{white}</div>
                          {analysis?.moves[wi] && (
                            <MoveBadge ma={analysis.moves[wi]} />
                          )}
                        </button>
                      ) : (
                        <span />
                      )}
                      {black ? (
                        <button
                          onClick={() => setMoveIndex(bi + 1)}
                          className={`rounded px-1.5 py-1 text-left ${
                            moveIndex === bi + 1
                              ? "bg-[var(--color-accent)]/25 font-medium"
                              : "hover:bg-[var(--color-surface-3)]"
                          }`}
                        >
                          <div>{black}</div>
                          {analysis?.moves[bi] && (
                            <MoveBadge ma={analysis.moves[bi]} />
                          )}
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center text-[var(--color-muted)] lg:flex">
            Select a game to review
          </div>
        )}
      </div>
    </div>
  );
}
