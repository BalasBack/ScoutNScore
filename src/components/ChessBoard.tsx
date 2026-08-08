import { Component, CSSProperties, ReactNode } from "react";
import { Chessboard } from "react-chessboard";
import { START_FEN } from "../lib/chess";

export type SquareClickArgs = {
  piece: { pieceType: string } | null;
  square: string;
};

type ChessBoardProps = {
  fen: string;
  allowDragging?: boolean;
  showAnimations?: boolean;
  squareStyles?: Record<string, CSSProperties>;
  onPieceDrop?: (args: {
    piece: { position: string; pieceType: string; isSparePiece: boolean };
    sourceSquare: string;
    targetSquare: string | null;
  }) => boolean;
  onSquareClick?: (args: SquareClickArgs) => void;
};

type State = { error: string | null };

export class ChessBoardView extends Component<ChessBoardProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: Error): State {
    return { error: err.message };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-sm text-red-300">
          Board error: {this.state.error}
        </div>
      );
    }

    const position =
      !this.props.fen || this.props.fen === "start"
        ? START_FEN
        : this.props.fen;

    return (
      <div className="aspect-square h-full max-h-full w-full max-w-full">
        <Chessboard
          options={{
            position,
            allowDragging: this.props.allowDragging ?? false,
            onPieceDrop: this.props.onPieceDrop,
            onSquareClick: this.props.onSquareClick
              ? ({ piece, square }) => {
                  this.props.onSquareClick?.({
                    piece: piece
                      ? { pieceType: String(piece.pieceType) }
                      : null,
                    square,
                  });
                }
              : undefined,
            squareStyles: this.props.squareStyles,
            showAnimations: this.props.showAnimations ?? false,
            animationDurationInMs: 200,
            boardStyle: {
              borderRadius: "6px",
              width: "100%",
              height: "100%",
              boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
            },
            darkSquareStyle: { backgroundColor: "#769656" },
            lightSquareStyle: { backgroundColor: "#eeeed2" },
          }}
        />
      </div>
    );
  }
}
